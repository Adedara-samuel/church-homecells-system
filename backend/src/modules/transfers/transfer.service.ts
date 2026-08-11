import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { buildSort } from '../../middleware/validate';
import { assertHomecellInScope, assertInScope } from '../../middleware/scope';
import {
  AuditAction,
  AuditModule,
  MembershipStatus,
  NotificationSeverity,
  NotificationType,
  OrgStatus,
  Role,
  TransferApprovalStage,
  TransferScope,
  TransferStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { mergeFilters, paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { Member } from '../members/member.model';
import { notify, usersWithRole } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { MemberTransfer, type MemberTransferDoc, type TransferApprovalStep } from './transfer.model';

const SORTABLE = ['createdAt', 'requestedAt', 'status'];
const POPULATE = [
  { path: 'member', select: 'memberId firstName lastName phone photoUrl' },
  { path: 'previousHomecell', select: 'name code' },
  { path: 'newHomecell', select: 'name code' },
  { path: 'previousArea', select: 'name code' },
  { path: 'newArea', select: 'name code' },
  { path: 'previousZone', select: 'name code' },
  { path: 'newZone', select: 'name code' },
  { path: 'requestedBy', select: 'firstName lastName role' },
  { path: 'completedBy', select: 'firstName lastName role' },
  { path: 'approvalChain.approver', select: 'firstName lastName role' },
];

/** Classifies a move so the right approval chain is selected (SRS FR-TRANS-002/003). */
export function classifyTransfer(
  from: { zone: unknown; area: unknown },
  to: { zone: unknown; area: unknown },
): TransferScope {
  if (idString(from.zone) !== idString(to.zone)) return TransferScope.CROSS_ZONE;
  if (idString(from.area) !== idString(to.area)) return TransferScope.CROSS_AREA;
  return TransferScope.SAME_AREA;
}

async function approvalChainFor(scope: TransferScope): Promise<TransferApprovalStage[]> {
  const settings = await getSettings();
  switch (scope) {
    case TransferScope.CROSS_ZONE:
      return settings.transferApprovalChainCrossZone;
    case TransferScope.CROSS_AREA:
      return settings.transferApprovalChainCrossArea;
    default:
      return settings.transferApprovalChainSameArea;
  }
}

/**
 * Decides whether the acting user is allowed to sign off the stage currently awaiting
 * a decision, and that they belong to the correct part of the organisation for it.
 */
function canDecideStage(
  actor: AuthenticatedUser,
  stage: TransferApprovalStage,
  transfer: MemberTransferDoc,
): boolean {
  if (actor.role === Role.SYSTEM_ADMIN) return true;

  switch (stage) {
    case TransferApprovalStage.AREA_COORDINATOR:
      if (actor.role !== Role.AREA_COORDINATOR) {
        // A Church Admin may act on behalf of any stage.
        return actor.role === Role.CHURCH_ADMIN;
      }
      return (
        actor.areaId === idString(transfer.previousArea) ||
        actor.areaId === idString(transfer.newArea)
      );
    case TransferApprovalStage.ZONAL_COORDINATOR:
      if (actor.role !== Role.ZONAL_COORDINATOR) return actor.role === Role.CHURCH_ADMIN;
      return (
        actor.zoneId === idString(transfer.previousZone) ||
        actor.zoneId === idString(transfer.newZone)
      );
    case TransferApprovalStage.CHURCH_ADMIN:
      return actor.role === Role.CHURCH_ADMIN;
    default:
      return false;
  }
}

export interface InitiateTransferInput {
  memberId: string;
  destinationHomecellId: string;
  reason: string;
}

export async function initiateTransfer(
  actor: AuthenticatedUser,
  input: InitiateTransferInput,
  req: Request,
) {
  const member = await Member.findById(input.memberId);
  if (!member) throw new NotFoundError('Member');
  assertInScope(actor, { zone: member.zone, area: member.area, homecell: member.homecell });

  if (member.membershipStatus !== MembershipStatus.ACTIVE) {
    throw new ValidationError('Only active members can be transferred.');
  }

  const destination = await Homecell.findById(input.destinationHomecellId)
    .select('_id name area zone status')
    .lean();
  if (!destination) throw new ValidationError('Invalid transfer destination.');
  if (destination.status === OrgStatus.INACTIVE) {
    throw new ValidationError('Invalid transfer destination: that Homecell is inactive.');
  }
  if (idString(destination._id) === idString(member.homecell)) {
    throw new ValidationError('The member already belongs to that Homecell.');
  }

  const pending = await MemberTransfer.findOne({
    member: member._id,
    status: TransferStatus.PENDING,
  }).lean();
  if (pending) {
    throw new ConflictError('A transfer request for this member is already awaiting approval.');
  }

  const scope = classifyTransfer(
    { zone: member.zone, area: member.area },
    { zone: destination.zone, area: destination.area },
  );
  const stages = await approvalChainFor(scope);
  const approvalChain: TransferApprovalStep[] = stages.map((stage) => ({
    stage,
    approver: null,
    decidedAt: null,
    decision: null,
  }));

  const transfer = await MemberTransfer.create({
    reference: references.transfer(),
    member: member._id,
    previousZone: member.zone,
    previousArea: member.area,
    previousHomecell: member.homecell,
    newZone: destination.zone,
    newArea: destination.area,
    newHomecell: destination._id,
    scope,
    reason: input.reason,
    status: TransferStatus.PENDING,
    approvalChain,
    currentStageIndex: 0,
    requestedBy: actor.id,
    requestedAt: new Date(),
  });

  // An empty chain means no approval is configured for this kind of move.
  if (approvalChain.length === 0) {
    return finaliseApproval(actor, idString(transfer._id), req, 'Auto-approved: no approval stage configured');
  }

  await notifyStageApprovers(transfer);

  await recordAudit(
    {
      action: AuditAction.TRANSFER,
      module: AuditModule.TRANSFERS,
      description: `Transfer requested for ${member.firstName} ${member.lastName} (${member.memberId}) to ${destination.name}`,
      entityModel: 'MemberTransfer',
      entityId: transfer._id,
      entityLabel: transfer.reference,
      newValues: {
        scope,
        from: idString(member.homecell),
        to: idString(destination._id),
        reason: input.reason,
      },
      zone: member.zone,
      area: member.area,
      homecell: member.homecell,
    },
    req,
  );

  return getTransfer(actor, idString(transfer._id));
}

async function notifyStageApprovers(transfer: MemberTransferDoc): Promise<void> {
  const step = transfer.approvalChain[transfer.currentStageIndex];
  if (!step) return;

  const member = await Member.findById(transfer.member).select('firstName lastName memberId').lean();
  const label = member ? `${member.firstName} ${member.lastName}` : 'A member';

  let recipients: string[] = [];
  switch (step.stage) {
    case TransferApprovalStage.AREA_COORDINATOR:
      recipients = [
        ...(await usersWithRole(Role.AREA_COORDINATOR, { area: transfer.previousArea })),
        ...(await usersWithRole(Role.AREA_COORDINATOR, { area: transfer.newArea })),
      ];
      break;
    case TransferApprovalStage.ZONAL_COORDINATOR:
      recipients = [
        ...(await usersWithRole(Role.ZONAL_COORDINATOR, { zone: transfer.previousZone })),
        ...(await usersWithRole(Role.ZONAL_COORDINATOR, { zone: transfer.newZone })),
      ];
      break;
    case TransferApprovalStage.CHURCH_ADMIN:
      recipients = await usersWithRole(Role.CHURCH_ADMIN);
      break;
    default:
      break;
  }

  await notify({
    recipients,
    type: NotificationType.TRANSFER_INITIATED,
    severity: NotificationSeverity.INFO,
    title: 'Member transfer awaiting your approval',
    message: `${label} has a pending transfer request (${transfer.reference}) that needs your decision.`,
    entityModel: 'MemberTransfer',
    entityId: transfer._id,
    actionUrl: `/transfers/${idString(transfer._id)}`,
    zone: transfer.previousZone,
    area: transfer.previousArea,
    homecell: transfer.previousHomecell,
  });
}

export async function approveTransfer(
  actor: AuthenticatedUser,
  id: string,
  comment: string | undefined,
  req: Request,
) {
  const transfer = await MemberTransfer.findById(id);
  if (!transfer) throw new NotFoundError('Transfer');
  if (transfer.status !== TransferStatus.PENDING) {
    throw new ConflictError(`This transfer has already been ${transfer.status.toLowerCase()}.`);
  }

  const step = transfer.approvalChain[transfer.currentStageIndex];
  if (!step) throw new ConflictError('This transfer has no outstanding approval stage.');
  if (!canDecideStage(actor, step.stage, transfer)) {
    throw new ForbiddenError('You are not the designated approver for the current stage.');
  }

  step.approver = toObjectId(actor.id);
  step.decidedAt = new Date();
  step.decision = 'APPROVED';
  step.comment = comment;
  transfer.currentStageIndex += 1;
  transfer.markModified('approvalChain');

  // More stages left — pause here and notify the next approver.
  if (transfer.currentStageIndex < transfer.approvalChain.length) {
    await transfer.save();
    await notifyStageApprovers(transfer);
    await recordAudit(
      {
        action: AuditAction.APPROVE,
        module: AuditModule.TRANSFERS,
        description: `Transfer ${transfer.reference} approved at ${step.stage} stage`,
        entityModel: 'MemberTransfer',
        entityId: transfer._id,
        entityLabel: transfer.reference,
        zone: transfer.previousZone,
        area: transfer.previousArea,
        homecell: transfer.previousHomecell,
      },
      req,
    );
    return getTransfer(actor, id);
  }

  await transfer.save();
  return finaliseApproval(actor, id, req, comment);
}

/** Applies an approved transfer to the member record and closes the request. */
async function finaliseApproval(
  actor: AuthenticatedUser,
  id: string,
  req: Request,
  comment?: string,
) {
  const transfer = await MemberTransfer.findById(id);
  if (!transfer) throw new NotFoundError('Transfer');

  const member = await Member.findById(transfer.member);
  if (!member) throw new NotFoundError('Member');

  // BR-017: the previous assignment is preserved on the member and in the transfer record.
  member.previousHomecell = member.homecell;
  member.homecell = transfer.newHomecell;
  member.area = transfer.newArea;
  member.zone = transfer.newZone;
  member.updatedBy = toObjectId(actor.id);
  await member.save();

  transfer.status = TransferStatus.APPROVED;
  transfer.completedBy = toObjectId(actor.id);
  transfer.completedAt = new Date();
  await transfer.save();

  const destination = await Homecell.findById(transfer.newHomecell).select('name').lean();

  await notify({
    recipients: [
      idString(transfer.requestedBy),
      ...(await usersWithRole(Role.HOMECELL_COORDINATOR, { homecell: transfer.newHomecell })),
      ...(await usersWithRole(Role.HOMECELL_COORDINATOR, { homecell: transfer.previousHomecell })),
    ],
    type: NotificationType.TRANSFER_APPROVED,
    severity: NotificationSeverity.SUCCESS,
    title: 'Member transfer approved',
    message: `${member.firstName} ${member.lastName} has been transferred to ${
      destination?.name ?? 'the destination Homecell'
    }.${comment ? ` Note: ${comment}` : ''}`,
    entityModel: 'MemberTransfer',
    entityId: transfer._id,
    actionUrl: `/transfers/${idString(transfer._id)}`,
    zone: transfer.newZone,
    area: transfer.newArea,
    homecell: transfer.newHomecell,
  });

  await recordAudit(
    {
      action: AuditAction.TRANSFER,
      module: AuditModule.TRANSFERS,
      description: `Transfer ${transfer.reference} approved — ${member.memberId} moved to ${
        destination?.name ?? 'new Homecell'
      }`,
      entityModel: 'MemberTransfer',
      entityId: transfer._id,
      entityLabel: transfer.reference,
      previousValues: {
        homecell: idString(transfer.previousHomecell),
        area: idString(transfer.previousArea),
        zone: idString(transfer.previousZone),
      },
      newValues: {
        homecell: idString(transfer.newHomecell),
        area: idString(transfer.newArea),
        zone: idString(transfer.newZone),
      },
      zone: transfer.newZone,
      area: transfer.newArea,
      homecell: transfer.newHomecell,
    },
    req,
  );

  return getTransfer(actor, id);
}

export async function rejectTransfer(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const transfer = await MemberTransfer.findById(id);
  if (!transfer) throw new NotFoundError('Transfer');
  if (transfer.status !== TransferStatus.PENDING) {
    throw new ConflictError(`This transfer has already been ${transfer.status.toLowerCase()}.`);
  }

  const step = transfer.approvalChain[transfer.currentStageIndex];
  if (step && !canDecideStage(actor, step.stage, transfer)) {
    throw new ForbiddenError('You are not the designated approver for the current stage.');
  }

  if (step) {
    step.approver = toObjectId(actor.id);
    step.decidedAt = new Date();
    step.decision = 'REJECTED';
    step.comment = reason;
    transfer.markModified('approvalChain');
  }
  transfer.status = TransferStatus.REJECTED;
  transfer.rejectionReason = reason;
  transfer.completedBy = toObjectId(actor.id);
  transfer.completedAt = new Date();
  await transfer.save();

  const member = await Member.findById(transfer.member).select('firstName lastName memberId').lean();

  await notify({
    recipients: [idString(transfer.requestedBy)],
    type: NotificationType.TRANSFER_REJECTED,
    severity: NotificationSeverity.WARNING,
    title: 'Member transfer rejected',
    message: `The transfer request for ${member?.firstName ?? 'the member'} ${
      member?.lastName ?? ''
    } was rejected. Reason: ${reason}`,
    entityModel: 'MemberTransfer',
    entityId: transfer._id,
    actionUrl: `/transfers/${idString(transfer._id)}`,
    zone: transfer.previousZone,
    area: transfer.previousArea,
    homecell: transfer.previousHomecell,
  });

  await recordAudit(
    {
      action: AuditAction.REJECT,
      module: AuditModule.TRANSFERS,
      description: `Transfer ${transfer.reference} rejected — ${reason}`,
      entityModel: 'MemberTransfer',
      entityId: transfer._id,
      entityLabel: transfer.reference,
      zone: transfer.previousZone,
      area: transfer.previousArea,
      homecell: transfer.previousHomecell,
    },
    req,
  );

  return getTransfer(actor, id);
}

export async function cancelTransfer(actor: AuthenticatedUser, id: string, req: Request) {
  const transfer = await MemberTransfer.findById(id);
  if (!transfer) throw new NotFoundError('Transfer');
  if (transfer.status !== TransferStatus.PENDING) {
    throw new ConflictError('Only a pending transfer can be cancelled.');
  }
  if (idString(transfer.requestedBy) !== actor.id && actor.role !== Role.SYSTEM_ADMIN) {
    throw new ForbiddenError('Only the requester or a System Administrator can cancel this request.');
  }

  transfer.status = TransferStatus.CANCELLED;
  transfer.completedBy = toObjectId(actor.id);
  transfer.completedAt = new Date();
  await transfer.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.TRANSFERS,
      description: `Transfer ${transfer.reference} cancelled`,
      entityModel: 'MemberTransfer',
      entityId: transfer._id,
      entityLabel: transfer.reference,
      zone: transfer.previousZone,
      area: transfer.previousArea,
      homecell: transfer.previousHomecell,
    },
    req,
  );

  return getTransfer(actor, id);
}

export interface ListTransfersQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  status?: TransferStatus;
  scope?: TransferScope;
  memberId?: string;
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
}

/**
 * A transfer touches two places in the hierarchy, so scope matching considers both
 * the origin and the destination: an Area Coordinator sees moves out of and into
 * their Area.
 */
export async function listTransfers(actor: AuthenticatedUser, query: ListTransfersQuery) {
  const clauses: FilterQuery<MemberTransferDoc>[] = [];

  if (!actor.isChurchWide) {
    if (actor.homecellId) {
      clauses.push({
        $or: [
          { previousHomecell: toObjectId(actor.homecellId) },
          { newHomecell: toObjectId(actor.homecellId) },
        ],
      });
    } else if (actor.areaId) {
      clauses.push({
        $or: [{ previousArea: toObjectId(actor.areaId) }, { newArea: toObjectId(actor.areaId) }],
      });
    } else if (actor.zoneId) {
      clauses.push({
        $or: [{ previousZone: toObjectId(actor.zoneId) }, { newZone: toObjectId(actor.zoneId) }],
      });
    }
  }

  if (query.homecellId) {
    await assertHomecellInScope(actor, query.homecellId);
    clauses.push({
      $or: [
        { previousHomecell: toObjectId(query.homecellId) },
        { newHomecell: toObjectId(query.homecellId) },
      ],
    });
  }

  const filter: FilterQuery<MemberTransferDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.scope) filter.scope = query.scope;
  if (query.memberId) filter.member = toObjectId(query.memberId);
  if (clauses.length) filter.$and = clauses;

  return paginate(MemberTransfer, {
    filter: mergeFilters<MemberTransferDoc>(filter),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'createdAt'),
    populate: POPULATE,
  });
}

export async function getTransfer(actor: AuthenticatedUser, id: string) {
  const transfer = await MemberTransfer.findById(id).populate(POPULATE).lean();
  if (!transfer) throw new NotFoundError('Transfer');

  if (!actor.isChurchWide) {
    const matches = [
      idString(transfer.previousHomecell),
      idString(transfer.newHomecell),
    ].includes(actor.homecellId ?? '') ||
      [idString(transfer.previousArea), idString(transfer.newArea)].includes(actor.areaId ?? '') ||
      [idString(transfer.previousZone), idString(transfer.newZone)].includes(actor.zoneId ?? '');
    if (!matches) throw new NotFoundError('Transfer');
  }

  return transfer;
}

/** Full transfer history for one member (SRS FR-TRANS-004). */
export async function memberTransferHistory(actor: AuthenticatedUser, memberId: string) {
  const member = await Member.findById(memberId).select('zone area homecell').lean();
  if (!member) throw new NotFoundError('Member');
  assertInScope(actor, { zone: member.zone, area: member.area, homecell: member.homecell });

  return MemberTransfer.find({ member: toObjectId(memberId) })
    .sort({ createdAt: -1 })
    .populate(POPULATE)
    .lean();
}

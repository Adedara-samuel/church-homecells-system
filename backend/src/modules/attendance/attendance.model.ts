import { Schema, model, type Model, type Types } from 'mongoose';
import { ATTENDANCE_TYPES, AttendanceStatus, AttendanceType } from '../../types/enums';

export interface AttendanceDoc {
  _id: Types.ObjectId;
  member: Types.ObjectId;
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;

  type: AttendanceType;
  /** Normalised to UTC midnight — attendance is a calendar-day concept. */
  date: Date;
  status: AttendanceStatus;

  recordedBy: Types.ObjectId;
  updatedBy?: Types.ObjectId | null;
  note?: string;

  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<AttendanceDoc>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    type: { type: String, enum: ATTENDANCE_TYPES, required: true },
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(AttendanceStatus),
      required: true,
      default: AttendanceStatus.ABSENT,
    },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/**
 * BR-009 enforced at the storage layer: the database itself refuses a duplicate
 * Member + Homecell + Attendance Type + Date record, so a race between two
 * concurrent submissions cannot create one.
 */
attendanceSchema.index(
  { member: 1, homecell: 1, type: 1, date: 1 },
  { unique: true, name: 'attendance_unique_member_event_date' },
);
attendanceSchema.index({ homecell: 1, type: 1, date: -1 });
attendanceSchema.index({ area: 1, type: 1, date: -1 });
attendanceSchema.index({ zone: 1, type: 1, date: -1 });
attendanceSchema.index({ date: -1, type: 1 });
attendanceSchema.index({ member: 1, date: -1 });

export const Attendance: Model<AttendanceDoc> = model<AttendanceDoc>(
  'Attendance',
  attendanceSchema,
);

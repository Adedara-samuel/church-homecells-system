'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Save } from 'lucide-react';
import { areasService, homecellsService, membersService, zonesService } from '@/services';
import { queryKeys, useApiMutation } from '@/hooks/use-api';
import { humanise, toDateInput } from '@/lib/utils';
import type { Member } from '@/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FileUploadField, FormSection, SelectField } from '@/components/common/form';

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number');

const optionalPhone = z.union([phone, z.literal('')]).optional();
const optionalDate = z.union([z.string().date('Enter a valid date'), z.literal('')]).optional();

export const memberFormSchema = z.object({
  firstName: z.string().trim().min(2, 'First name is required'),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(2, 'Last name is required'),
  preferredName: z.string().trim().optional(),
  sex: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']),
  dateOfBirth: optionalDate,

  phone,
  alternatePhone: optionalPhone,
  email: z.union([z.string().email('Enter a valid email address'), z.literal('')]).optional(),

  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED']),
  weddingAnniversary: optionalDate,

  residentialAddress: z.string().trim().optional(),
  locationState: z.string().trim().optional(),
  locationLga: z.string().trim().optional(),
  locationCity: z.string().trim().optional(),
  locationCommunity: z.string().trim().optional(),
  occupation: z.string().trim().optional(),

  emergencyName: z.string().trim().optional(),
  emergencyRelationship: z.string().trim().optional(),
  emergencyPhone: optionalPhone,

  dateJoinedChurch: optionalDate,
  membershipStatus: z
    .enum(['ACTIVE', 'INACTIVE', 'TRANSFERRED_OUT', 'RELOCATED', 'DECEASED'])
    .optional(),
  membershipCategory: z.enum(['NEW_CONVERT', 'MEMBER', 'WORKER', 'LEADER', 'MINISTER']),

  zoneId: z.string().optional(),
  areaId: z.string().optional(),
  homecellId: z.string().min(1, 'Select the Homecell this member belongs to'),

  baptismStatus: z.enum(['NOT_BAPTISED', 'WATER_BAPTISED', 'SPIRIT_BAPTISED', 'BOTH']),
  department: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type MemberFormValues = z.infer<typeof memberFormSchema>;

const SEXES = ['MALE', 'FEMALE', 'UNSPECIFIED'];
const MARITAL = ['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'];
const CATEGORIES = ['NEW_CONVERT', 'MEMBER', 'WORKER', 'LEADER', 'MINISTER'];
const BAPTISM = ['NOT_BAPTISED', 'WATER_BAPTISED', 'SPIRIT_BAPTISED', 'BOTH'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSFERRED_OUT', 'RELOCATED', 'DECEASED'];

const toOptions = (values: string[]) => values.map((v) => ({ value: v, label: humanise(v) }));

/** Strips empty strings so optional fields are omitted rather than stored blank. */
function clean<T extends Record<string, unknown>>(values: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function MemberForm({ member }: { member?: Member }) {
  const router = useRouter();
  const isEdit = Boolean(member);

  const [photo, setPhoto] = React.useState<{ url: string; publicId: string } | null>(
    member?.photoUrl ? { url: member.photoUrl, publicId: member.photoPublicId ?? '' } : null,
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: {
      firstName: member?.firstName ?? '',
      middleName: member?.middleName ?? '',
      lastName: member?.lastName ?? '',
      preferredName: member?.preferredName ?? '',
      sex: member?.sex ?? 'UNSPECIFIED',
      dateOfBirth: member?.dateOfBirth?.slice(0, 10) ?? '',
      phone: member?.phone ?? '',
      alternatePhone: member?.alternatePhone ?? '',
      email: member?.email ?? '',
      maritalStatus: member?.maritalStatus ?? 'SINGLE',
      weddingAnniversary: member?.weddingAnniversary?.slice(0, 10) ?? '',
      residentialAddress: member?.residentialAddress ?? '',
      locationState: member?.location?.state ?? '',
      locationLga: member?.location?.lga ?? '',
      locationCity: member?.location?.city ?? '',
      locationCommunity: member?.location?.community ?? '',
      occupation: member?.occupation ?? '',
      emergencyName: member?.emergencyContact?.name ?? '',
      emergencyRelationship: member?.emergencyContact?.relationship ?? '',
      emergencyPhone: member?.emergencyContact?.phone ?? '',
      dateJoinedChurch: member?.dateJoinedChurch?.slice(0, 10) ?? '',
      membershipStatus: member?.membershipStatus ?? 'ACTIVE',
      membershipCategory: member?.membershipCategory ?? 'MEMBER',
      zoneId: member?.zone?._id ?? '',
      areaId: member?.area?._id ?? '',
      homecellId: member?.homecell?._id ?? '',
      baptismStatus: member?.baptismStatus ?? 'NOT_BAPTISED',
      department: member?.department ?? '',
      notes: member?.notes ?? '',
    },
  });

  const zoneId = watch('zoneId');
  const areaId = watch('areaId');
  const maritalStatus = watch('maritalStatus');

  const zones = useQuery({ queryKey: [...queryKeys.zones, 'options'], queryFn: zonesService.options });
  const areas = useQuery({
    queryKey: [...queryKeys.areas, 'options', zoneId || 'all'],
    queryFn: () => areasService.options(zoneId || undefined),
  });
  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', zoneId || 'all', areaId || 'all'],
    queryFn: () => homecellsService.options({ zoneId: zoneId || undefined, areaId: areaId || undefined }),
  });

  const mutation = useApiMutation(
    (values: MemberFormValues) => {
      const {
        zoneId: _zone,
        areaId: _area,
        locationState,
        locationLga,
        locationCity,
        locationCommunity,
        emergencyName,
        emergencyRelationship,
        emergencyPhone,
        ...rest
      } = values;

      const payload = {
        ...clean(rest),
        location: clean({
          state: locationState,
          lga: locationLga,
          city: locationCity,
          community: locationCommunity,
        }),
        emergencyContact: clean({
          name: emergencyName,
          relationship: emergencyRelationship,
          phone: emergencyPhone,
        }),
        photoUrl: photo?.url ?? null,
        photoPublicId: photo?.publicId ?? null,
      };

      // The Homecell is fixed after registration — moving a member is a transfer.
      if (isEdit) {
        const { homecellId: _hc, ...editable } = payload as Record<string, unknown>;
        return membersService.update(member!._id, editable);
      }
      return membersService.create(payload);
    },
    {
      successMessage: isEdit ? 'Member updated' : 'Member registered',
      invalidates: [queryKeys.members, queryKeys.dashboard],
      onSuccess: (saved) => router.push(`/members/${saved._id}`),
    },
  );

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-5" noValidate>
      <FormSection title="Personal information" description="Core identity details for the member.">
        <Field label="First name" htmlFor="firstName" required error={errors.firstName?.message}>
          <Input id="firstName" {...register('firstName')} aria-invalid={Boolean(errors.firstName)} />
        </Field>
        <Field label="Last name" htmlFor="lastName" required error={errors.lastName?.message}>
          <Input id="lastName" {...register('lastName')} aria-invalid={Boolean(errors.lastName)} />
        </Field>
        <Field label="Middle name" htmlFor="middleName">
          <Input id="middleName" {...register('middleName')} />
        </Field>
        <Field label="Preferred name" htmlFor="preferredName" hint="Used in SMS greetings">
          <Input id="preferredName" {...register('preferredName')} />
        </Field>
        <Field label="Sex" required error={errors.sex?.message}>
          <Controller
            control={control}
            name="sex"
            render={({ field }) => (
              <SelectField value={field.value} onChange={field.onChange} options={toOptions(SEXES)} />
            )}
          />
        </Field>
        <Field label="Date of birth" htmlFor="dateOfBirth" error={errors.dateOfBirth?.message}>
          <Controller
            control={control}
            name="dateOfBirth"
            render={({ field }) => (
              <DatePicker
                id="dateOfBirth"
                value={field.value}
                // The schema treats '' as "not provided"; undefined would fail the
                // union that allows an empty string.
                onChange={(date) => field.onChange(date ?? '')}
                onBlur={field.onBlur}
                max={toDateInput()}
                invalid={Boolean(errors.dateOfBirth)}
              />
            )}
          />
        </Field>
        <Field label="Marital status" required>
          <Controller
            control={control}
            name="maritalStatus"
            render={({ field }) => (
              <SelectField value={field.value} onChange={field.onChange} options={toOptions(MARITAL)} />
            )}
          />
        </Field>
        {maritalStatus === 'MARRIED' && (
          <Field
            label="Wedding anniversary"
            htmlFor="weddingAnniversary"
            hint="Enables the automatic anniversary SMS"
            error={errors.weddingAnniversary?.message}
          >
            <Controller
              control={control}
              name="weddingAnniversary"
              render={({ field }) => (
                <DatePicker
                  id="weddingAnniversary"
                  value={field.value}
                  onChange={(date) => field.onChange(date ?? '')}
                  onBlur={field.onBlur}
                  max={toDateInput()}
                  invalid={Boolean(errors.weddingAnniversary)}
                />
              )}
            />
          </Field>
        )}
        <Field label="Profile photograph" className="sm:col-span-2">
          <FileUploadField
            value={photo}
            onChange={setPhoto}
            folder="members"
            accept="image/jpeg,image/png,image/webp"
            label="Upload photograph"
          />
        </Field>
      </FormSection>

      <FormSection title="Contact details" description="How the church reaches this member.">
        <Field label="Phone number" htmlFor="phone" required error={errors.phone?.message}>
          <Input id="phone" inputMode="tel" placeholder="+2348030000000" {...register('phone')} />
        </Field>
        <Field label="Alternate phone" htmlFor="alternatePhone" error={errors.alternatePhone?.message}>
          <Input id="alternatePhone" inputMode="tel" {...register('alternatePhone')} />
        </Field>
        <Field label="Email address" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Occupation" htmlFor="occupation">
          <Input id="occupation" {...register('occupation')} />
        </Field>
        <Field label="Residential address" htmlFor="residentialAddress" className="sm:col-span-2">
          <Input id="residentialAddress" {...register('residentialAddress')} />
        </Field>
        <Field label="State" htmlFor="locationState">
          <Input id="locationState" {...register('locationState')} />
        </Field>
        <Field label="Local Government Area" htmlFor="locationLga">
          <Input id="locationLga" {...register('locationLga')} />
        </Field>
        <Field label="City / town" htmlFor="locationCity">
          <Input id="locationCity" {...register('locationCity')} />
        </Field>
        <Field label="Community" htmlFor="locationCommunity">
          <Input id="locationCommunity" {...register('locationCommunity')} />
        </Field>
      </FormSection>

      <FormSection title="Emergency contact">
        <Field label="Contact name" htmlFor="emergencyName">
          <Input id="emergencyName" {...register('emergencyName')} />
        </Field>
        <Field label="Relationship" htmlFor="emergencyRelationship">
          <Input id="emergencyRelationship" {...register('emergencyRelationship')} />
        </Field>
        <Field label="Contact phone" htmlFor="emergencyPhone" error={errors.emergencyPhone?.message}>
          <Input id="emergencyPhone" inputMode="tel" {...register('emergencyPhone')} />
        </Field>
      </FormSection>

      <FormSection
        title="Church information"
        description={
          isEdit
            ? 'The Homecell assignment is changed through a member transfer, which keeps a permanent history.'
            : 'Choosing a Homecell automatically determines the Area and Zone.'
        }
      >
        {!isEdit && (
          <>
            <Field label="Zone" hint="Narrows the Homecell list">
              <Controller
                control={control}
                name="zoneId"
                render={({ field }) => (
                  <SelectField
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      setValue('areaId', '');
                      setValue('homecellId', '');
                    }}
                    placeholder="All zones"
                    options={(zones.data ?? []).map((z) => ({ value: z._id, label: z.name }))}
                  />
                )}
              />
            </Field>
            <Field label="Area" hint="Narrows the Homecell list">
              <Controller
                control={control}
                name="areaId"
                render={({ field }) => (
                  <SelectField
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      setValue('homecellId', '');
                    }}
                    placeholder="All areas"
                    options={(areas.data ?? []).map((a) => ({ value: a._id, label: a.name }))}
                  />
                )}
              />
            </Field>
            <Field label="Homecell" required error={errors.homecellId?.message}>
              <Controller
                control={control}
                name="homecellId"
                render={({ field }) => (
                  <SelectField
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Select a Homecell"
                    options={(homecells.data ?? []).map((h) => ({
                      value: h._id,
                      label: `${h.name} (${h.code})`,
                    }))}
                  />
                )}
              />
            </Field>
          </>
        )}

        <Field label="Date joined church" htmlFor="dateJoinedChurch" error={errors.dateJoinedChurch?.message}>
          <Controller
            control={control}
            name="dateJoinedChurch"
            render={({ field }) => (
              <DatePicker
                id="dateJoinedChurch"
                value={field.value}
                onChange={(date) => field.onChange(date ?? '')}
                onBlur={field.onBlur}
                max={toDateInput()}
                invalid={Boolean(errors.dateJoinedChurch)}
              />
            )}
          />
        </Field>
        <Field label="Membership category" required>
          <Controller
            control={control}
            name="membershipCategory"
            render={({ field }) => (
              <SelectField value={field.value} onChange={field.onChange} options={toOptions(CATEGORIES)} />
            )}
          />
        </Field>
        {isEdit && (
          <Field label="Membership status">
            <Controller
              control={control}
              name="membershipStatus"
              render={({ field }) => (
                <SelectField value={field.value} onChange={field.onChange} options={toOptions(STATUSES)} />
              )}
            />
          </Field>
        )}
        <Field label="Baptism status">
          <Controller
            control={control}
            name="baptismStatus"
            render={({ field }) => (
              <SelectField value={field.value} onChange={field.onChange} options={toOptions(BAPTISM)} />
            )}
          />
        </Field>
        <Field label="Department / unit" htmlFor="department">
          <Input id="department" {...register('department')} />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" rows={3} {...register('notes')} />
        </Field>
      </FormSection>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting || mutation.isPending}>
          <Save className="h-4 w-4" />
          {isEdit ? 'Save changes' : 'Register member'}
        </Button>
      </div>
    </form>
  );
}

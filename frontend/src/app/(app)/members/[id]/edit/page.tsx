'use client';

import { useParams } from 'next/navigation';
import { membersService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import { PageHeader } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { MemberForm } from '../../member-form';

export default function EditMemberPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.members, params.id],
    () => membersService.get(params.id),
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const fullName = `${data.firstName} ${data.lastName}`;

  return (
    <>
      <PageHeader
        title={`Edit ${fullName}`}
        description={data.memberId}
        breadcrumbs={[
          { label: 'Members', href: '/members' },
          { label: fullName, href: `/members/${data._id}` },
          { label: 'Edit' },
        ]}
      />
      <MemberForm member={data} />
    </>
  );
}

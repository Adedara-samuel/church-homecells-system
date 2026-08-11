'use client';

import { PageHeader } from '@/components/common/page';
import { MemberForm } from '../member-form';

export default function NewMemberPage() {
  return (
    <>
      <PageHeader
        title="Register member"
        description="Add a new member to the church register. A member ID is generated automatically."
        breadcrumbs={[{ label: 'Members', href: '/members' }, { label: 'Register' }]}
      />
      <MemberForm />
    </>
  );
}

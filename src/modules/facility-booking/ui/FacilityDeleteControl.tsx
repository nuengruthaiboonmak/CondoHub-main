'use client';
import { ResourceDeleteControl } from '@/shared/ui';
export function FacilityDeleteControl({ facilityId, name }: { facilityId: string; name: string }) {
  return (
    <ResourceDeleteControl
      resource="facility"
      name={name}
      endpoint={`/api/admin/facilities/${facilityId}`}
      testId="facility-delete"
      redirectTo="/admin/facilities"
      description="This facility will be removed from the directory. Cancel active or upcoming bookings first. Booking history stays recorded."
    />
  );
}

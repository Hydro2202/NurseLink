export type UserRole = 'staff_nurse' | 'supervisor';

export interface User {
  id: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  role: UserRole;
  email: string;
  department: string;
  licenseNumber?: string;
  avatar?: string;
  shift?: string;
  clinicalRole?: string;
  specialization?: string;
}

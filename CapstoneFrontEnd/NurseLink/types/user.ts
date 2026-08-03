export type UserRole = 'staff_nurse' | 'supervisor';
export type AccountStatus = 'pending' | 'approved' | 'rejected';

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
  accountStatus?: AccountStatus;
}

export interface RegistrationDetails {
  licenseNumber: string;
  selectedRole: string;
  ocrPosition: string;
  hospitalName: string;
  department: string;
  employeeId: string;
}

export type SignupPayload = Omit<User, 'id'> & {
  password: string;
  employeeId?: string;
  hospitalName?: string;
  ocrPosition?: string;
  registrationDetails?: RegistrationDetails;
};

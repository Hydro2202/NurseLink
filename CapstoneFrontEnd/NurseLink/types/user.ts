// 'admin' is never selectable at login (the login screen only offers the
// other two) — it's what a real is_staff account's own role always comes
// back as, regardless of which button was pressed. See LoginView/isAdmin.
export type UserRole = 'staff_nurse' | 'supervisor' | 'admin';

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
  /** True only for a real Django is_staff account — the trustworthy signal
   * behind role === 'admin'. See permissions.IsAdmin on the backend for why
   * this is never inferred from the email address. */
  isAdmin?: boolean;
}

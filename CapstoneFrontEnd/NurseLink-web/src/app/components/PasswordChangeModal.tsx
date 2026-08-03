import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import { Progress } from './ui/progress';

interface PasswordChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (currentPassword: string, newPassword: string) => Promise<void>;
}

export function PasswordChangeModal({ open, onOpenChange, onSave }: PasswordChangeModalProps) {
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setErrors({});
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    }
  }, [open]);

  const calculatePasswordStrength = (password: string): number => {
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (password.length >= 12) strength += 25;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password)) strength += 12.5;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 12.5;
    return Math.min(strength, 100);
  };

  const passwordStrength = calculatePasswordStrength(formData.newPassword);

  const getPasswordStrengthLabel = (strength: number): string => {
    if (strength < 25) return 'Very Weak';
    if (strength < 50) return 'Weak';
    if (strength < 75) return 'Good';
    return 'Strong';
  };

  const getPasswordStrengthColor = (strength: number): string => {
    if (strength < 25) return 'bg-red-500';
    if (strength < 50) return 'bg-orange-500';
    if (strength < 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }
    
    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword = 'Password must be at least 8 characters';
    } else if (formData.newPassword === formData.currentPassword) {
      newErrors.newPassword = 'New password must be different from current password';
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    
    try {
      await onSave(formData.currentPassword, formData.newPassword);
      onOpenChange(false);
    } catch (error) {
      console.error('Error changing password:', error);
    } finally {
      setLoading(false);
    }
  };

  const passwordRequirements = [
    { met: formData.newPassword.length >= 8, label: 'At least 8 characters' },
    { met: /[a-z]/.test(formData.newPassword) && /[A-Z]/.test(formData.newPassword), label: 'Mixed case letters' },
    { met: /[0-9]/.test(formData.newPassword), label: 'Contains numbers' },
    { met: /[^a-zA-Z0-9]/.test(formData.newPassword), label: 'Contains special characters' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Change Password</DialogTitle>
          <DialogDescription className="text-sm">
            Ensure your account is using a strong and secure password.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          <div className="space-y-2">
            <Label htmlFor="currentPassword" className="text-sm font-medium">Current Password *</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showCurrentPassword ? 'text' : 'password'}
                placeholder="Enter your current password"
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                className={errors.currentPassword ? 'border-red-500 focus-visible:ring-red-500 pr-10' : 'pr-10'}
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.currentPassword && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1.5">
                <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                {errors.currentPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword" className="text-sm font-medium">New Password *</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Enter your new password"
                value={formData.newPassword}
                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                className={errors.newPassword ? 'border-red-500 focus-visible:ring-red-500 pr-10' : 'pr-10'}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.newPassword && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1.5">
                <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                {errors.newPassword}
              </p>
            )}
            
            {formData.newPassword && (
              <div className="space-y-2 mt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Password Strength</span>
                  <span className={`font-semibold ${
                    passwordStrength < 50 ? 'text-red-600' : 
                    passwordStrength < 75 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {getPasswordStrengthLabel(passwordStrength)}
                  </span>
                </div>
                <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${getPasswordStrengthColor(passwordStrength)}`}
                    style={{ width: `${passwordStrength}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm New Password *</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm your new password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className={errors.confirmPassword ? 'border-red-500 focus-visible:ring-red-500 pr-10' : 'pr-10'}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-red-600 flex items-center gap-1 mt-1.5">
                <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                {errors.confirmPassword}
              </p>
            )}
          </div>

          {formData.newPassword && (
            <div className="p-4 bg-muted/50 rounded-lg border border-border/50 space-y-2">
              <p className="text-xs font-semibold text-foreground mb-2">Password Requirements</p>
              <div className="space-y-1.5">
                {passwordRequirements.map((req, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {req.met ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={req.met ? 'text-green-700' : 'text-muted-foreground'}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-primary hover:bg-primary-hover w-full sm:w-auto"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Changing...
                </>
              ) : (
                'Change Password'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
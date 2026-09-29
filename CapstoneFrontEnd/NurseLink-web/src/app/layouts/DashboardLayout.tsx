import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Activity,
  Bell,
  User,
  Menu,
  X,
  BookOpen,
  Users,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { NotificationPanel } from '../components/NotificationPanel';
// Tightly cropped to just the circular emblem mark (no "NURSELINK" wordmark,
// no surrounding empty canvas) — the original figma:asset export is a full
// lockup on a wide mostly-transparent canvas, which made the mark itself
// render tiny inside every small logo box here even at 100% container fill.
// The "NurseLink" text is already rendered separately next to each of these
// boxes, so the wordmark baked into the original asset was redundant anyway.
import nurseLinkLogo from '../../assets/branding/nurselink-emblem.png';

export default function DashboardLayout() {
  const { user, logout, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = React.useState(false);
  const [isDesktop, setIsDesktop] = React.useState(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);

  // Track window resize for responsive behavior
  React.useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!isLoading && !user) {
      navigate('/login');
    }
  }, [user, isLoading, navigate]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <Activity className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if no user
  if (!user) {
    return null;
  }

  const isStaffNurse = user?.role === 'staff_nurse';
  const isSupervisor = user?.role === 'head_nurse';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: true },
    { name: 'Tasks', href: '/tasks', icon: ClipboardList, show: isStaffNurse },
    { name: 'Handover', href: '/handover', icon: FileText, show: isStaffNurse },
    { name: 'Charting', href: '/charting', icon: FileText, show: isStaffNurse },
    { name: 'Kardex', href: '/kardex', icon: BookOpen, show: isStaffNurse },
    { name: 'All Patients', href: '/all-patients', icon: Users, show: isSupervisor },
    { name: 'Analytics', href: '/analytics', icon: BarChart3, show: isSupervisor },
    { name: 'Workload Monitor', href: '/workload', icon: BarChart3, show: isSupervisor },
    { name: 'Settings', href: '/settings', icon: Settings, show: true },
  ].filter(item => item.show);

  // Head nurse mobile navigation
  const supervisorMobileNav = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Patients', href: '/all-patients', icon: Users },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Workload', href: '/workload', icon: BarChart3 },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isActive = (href: string) => location.pathname === href;

  // Mobile view for staff nurses (UNCHANGED)
  if (isStaffNurse && !isDesktop) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        {/* Mobile Top Bar - Enhanced */}
        <header className="bg-gradient-to-r from-white via-blue-50 to-blue-100 border-b-2 border-blue-300 px-3 py-2 flex items-center justify-between sticky top-0 z-50 shadow-lg shadow-blue-500/10">
          <div className="flex items-center gap-2">
            <div className="bg-white rounded-2xl px-3 py-1.5 flex items-center gap-2 shadow-md">
              <div className="w-10 h-10 flex items-center justify-center">
                <img src={nurseLinkLogo} alt="NurseLink" className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="font-black text-blue-600 text-sm leading-tight block">NurseLink</span>
                <p className="text-[9px] text-blue-500 font-semibold leading-tight">Staff Portal</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button 
              variant="ghost" 
              size="icon-sm" 
              className="relative rounded-xl hover:bg-blue-100 transition-all h-8 w-8"
              onClick={() => setNotificationPanelOpen(true)}
            >
              <Bell className="w-4 h-4 text-blue-600" />
              <Badge className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center p-0 bg-gradient-to-br from-blue-500 to-blue-700 text-white text-[9px] font-black shadow-md">
                5
              </Badge>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-xl hover:bg-blue-100 h-8 w-8">
                  {user?.avatar ? (
                    <img 
                      src={user.avatar} 
                      alt="Profile" 
                      className="w-7 h-7 rounded-lg object-cover shadow-md"
                    />
                  ) : (
                    <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center shadow-md">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 border-2 border-blue-200 shadow-xl">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1.5">
                    <p className="text-sm font-black leading-none text-gray-900">{user?.name}</p>
                    <p className="text-xs leading-none text-blue-600 font-semibold">{user?.email}</p>
                    <p className="text-xs leading-none text-blue-700 font-semibold">{user?.department}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer font-semibold">
                  <Settings className="mr-2 h-4 w-4 text-blue-600" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowLogoutDialog(true)} className="text-red-600 focus:text-red-700 focus:bg-red-100 cursor-pointer font-semibold">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-24">
          <Outlet />
        </main>

        {/* Mobile Bottom Navigation - Enhanced for touch */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 px-1 py-2 z-50 shadow-2xl">
          <div className="flex items-center justify-around max-w-lg mx-auto">
            {navigation.slice(0, 5).map((item, index) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              // Define colors for each section
              const colors = [
                { text: 'text-blue-600' }, // Dashboard
                { text: 'text-green-600' }, // Tasks
                { text: 'text-purple-600' }, // Handover
                { text: 'text-orange-600' }, // Charting
                { text: 'text-gray-600' }, // Kardex
              ];
              const colorScheme = colors[index] || colors[0];
              
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex flex-col items-center gap-1 py-2.5 px-4 rounded-2xl transition-all min-w-[68px] touch-manipulation ${ 
                    active ? 'scale-110 -translate-y-2' : 'active:scale-95'
                  }`}
                >
                  <Icon 
                    className={`w-6 h-6 transition-colors ${colorScheme.text}`} 
                  />
                  <span 
                    className={`text-[10px] font-black transition-colors leading-tight text-center ${colorScheme.text}`}
                  >
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Logout Confirmation Dialog */}
        <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to log out? You will need to sign in again to access the system.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive-hover">
                Logout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Notification Panel */}
        <NotificationPanel 
          isOpen={notificationPanelOpen} 
          onClose={() => setNotificationPanelOpen(false)} 
        />
      </div>
    );
  }

  // Mobile view for head nurses (UNCHANGED)
  if (isSupervisor && !isDesktop) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        {/* Mobile Top Bar */}
        <header className="bg-gradient-to-r from-white via-blue-50 to-blue-100 border-b-4 border-blue-300 px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-xl shadow-blue-500/20">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-md p-2">
              <img src={nurseLinkLogo} alt="NurseLink" className="w-full h-full object-contain" />
            </div>
            <div>
              <span className="font-black text-transparent bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-xl">NurseLink</span>
              <p className="text-xs text-blue-600 font-bold">Head Nurse Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon-sm" 
              className="relative rounded-2xl hover:bg-blue-100 transition-all"
              onClick={() => setNotificationPanelOpen(true)}
            >
              <Bell className="w-5 h-5 text-blue-600" />
              <Badge className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center p-0 bg-gradient-to-br from-blue-500 to-blue-700 text-white text-[10px] font-black shadow-lg">
                5
              </Badge>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-2xl hover:bg-blue-100">
                  <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-lg">
                    <User className="w-5 h-5 text-white" />
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 border-2 border-blue-200 shadow-xl">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1.5">
                    <p className="text-sm font-black leading-none text-gray-900">{user?.name}</p>
                    <p className="text-xs leading-none text-blue-600 font-semibold">{user?.email}</p>
                    <p className="text-xs leading-none text-blue-700 font-semibold">{user?.department}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer font-semibold">
                  <Settings className="mr-2 h-4 w-4 text-blue-600" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowLogoutDialog(true)} className="text-red-600 focus:text-red-700 focus:bg-red-100 cursor-pointer font-semibold">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-24">
          <Outlet />
        </main>

        {/* Head Nurse Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 px-1 py-2 z-50 shadow-2xl">
          <div className="flex items-center justify-around max-w-lg mx-auto">
            {supervisorMobileNav.map((item, index) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const colors = [
                { text: 'text-blue-600' }, // Dashboard
                { text: 'text-purple-600' }, // Patients
                { text: 'text-green-600' }, // Analytics
                { text: 'text-orange-600' }, // Workload
                { text: 'text-gray-600' }, // Settings
              ];
              const colorScheme = colors[index] || colors[0];
              
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex flex-col items-center gap-1 py-2.5 px-4 rounded-2xl transition-all min-w-[68px] touch-manipulation ${ 
                    active ? 'scale-110 -translate-y-2' : 'active:scale-95'
                  }`}
                >
                  <Icon 
                    className={`w-6 h-6 transition-colors ${colorScheme.text}`} 
                  />
                  <span 
                    className={`text-[10px] font-black transition-colors leading-tight text-center ${colorScheme.text}`}
                  >
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Logout Confirmation Dialog */}
        <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to log out? You will need to sign in again to access the system.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive-hover">
                Logout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Notification Panel */}
        <NotificationPanel 
          isOpen={notificationPanelOpen} 
          onClose={() => setNotificationPanelOpen(false)} 
        />
      </div>
    );
  }

  // Desktop/Web view for BOTH Staff Nurses and Head Nurses
  const portalName = isStaffNurse ? 'Staff Portal' : 'Management Portal';

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      {/* Sidebar - Enhanced */}
      <aside
        className={`bg-gradient-to-b from-white via-blue-50 to-blue-100 border-r-4 border-blue-300 flex-shrink-0 shadow-2xl shadow-blue-500/20 w-64 ${
          sidebarOpen ? 'block' : 'hidden'
        } lg:block`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b-4 border-blue-300 bg-gradient-to-r from-blue-50 to-blue-100">
            <div className="bg-white rounded-2xl flex items-center justify-center shadow-lg p-2 w-16 h-16">
              <img src={nurseLinkLogo} alt="NurseLink" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="font-black bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-transparent text-xl">NurseLink</h1>
              <p className="text-xs text-blue-600 font-bold">{portalName}</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${
                    active
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white font-black shadow-xl scale-105'
                      : 'text-blue-700 hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-200 hover:text-blue-900 font-semibold hover:scale-105'
                  }`}
                >
                  <Icon className={`w-5 h-5 flex-shrink-0 transition-transform ${active ? '' : 'group-hover:scale-110'}`} />
                  <span className="text-sm">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Profile & Logout */}
          <div className="border-t-4 border-blue-300 p-4 space-y-3 bg-gradient-to-r from-blue-50 to-blue-100">
            <div className="flex items-center gap-3 px-2 p-3 bg-gradient-to-r from-blue-100 to-blue-200 rounded-2xl shadow-lg">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt="Profile"
                  className="w-11 h-11 rounded-xl object-cover shadow-lg"
                />
              ) : (
                <div className="w-11 h-11 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-lg">
                  <User className="w-6 h-6 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-blue-600 truncate font-bold">{user?.department}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 border-0 shadow-lg hover:shadow-xl font-black"
              onClick={() => setShowLogoutDialog(true)}
            >
              <LogOut className="w-5 h-5 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar - Enhanced */}
        <header className="bg-gradient-to-r from-white via-blue-50 to-blue-100 border-b-4 border-blue-300 px-6 py-4 flex items-center justify-between shadow-xl shadow-blue-500/20">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden rounded-2xl hover:bg-blue-100"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5 text-blue-600" /> : <Menu className="w-5 h-5 text-blue-600" />}
            </Button>
            <div>
              <h2 className="text-2xl font-black bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-transparent">
                {navigation.find(item => isActive(item.href))?.name || 'Dashboard'}
              </h2>
              <p className="text-sm text-blue-600 font-bold">Welcome back, {user?.name} 👋</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="relative rounded-2xl hover:bg-blue-100"
              onClick={() => setNotificationPanelOpen(true)}
            >
              <Bell className="w-5 h-5 text-blue-600" />
              <Badge className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center p-0 bg-gradient-to-br from-blue-500 to-blue-700 text-white text-[10px] font-black shadow-lg">
                5
              </Badge>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-2xl hover:bg-blue-100">
                  {user?.avatar ? (
                    <img 
                      src={user.avatar} 
                      alt="Profile" 
                      className="w-9 h-9 rounded-xl object-cover shadow-lg"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-lg">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 border-2 border-blue-200 shadow-xl">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1.5">
                    <p className="text-sm font-black leading-none text-gray-900">{user?.name}</p>
                    <p className="text-xs leading-none text-blue-600 font-semibold">{user?.email}</p>
                    <p className="text-xs leading-none text-blue-700 font-semibold">{user?.department}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer font-semibold">
                  <Settings className="mr-2 h-4 w-4 text-blue-600" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowLogoutDialog(true)} className="text-red-600 focus:text-red-700 focus:bg-red-100 cursor-pointer font-semibold">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out? You will need to sign in again to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive hover:bg-destructive-hover">
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notification Panel */}
      <NotificationPanel 
        isOpen={notificationPanelOpen} 
        onClose={() => setNotificationPanelOpen(false)} 
      />
    </div>
  );
}
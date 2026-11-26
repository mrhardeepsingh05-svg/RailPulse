import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CardSkeleton } from './components/ui/Badges';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { UserRole } from './types';

const AppLayout = lazy(() => import('./components/Layout').then((m) => ({ default: m.AppLayout })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AssetsPage = lazy(() => import('./pages/AssetsPage').then((m) => ({ default: m.AssetsPage })));
const InspectionsPage = lazy(() => import('./pages/InspectionsPage').then((m) => ({ default: m.InspectionsPage })));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage })));
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const PredictivePage = lazy(() => import('./pages/PredictivePage').then((m) => ({ default: m.PredictivePage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })));

function ProtectedRoute({
  title,
  allowedRoles,
  children,
}: {
  title: string;
  allowedRoles?: UserRole[];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] p-8">
        <div className="max-w-3xl mx-auto">
          <CardSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<CardSkeleton rows={4} />}>
        <LoginPage />
      </Suspense>
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <Suspense fallback={<CardSkeleton rows={4} />}>
        <AppLayout title="Access Restricted">
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            Your role ({user.role_display}) does not have permission to view this page.
          </div>
        </AppLayout>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<CardSkeleton rows={5} />}>
      <AppLayout title={title}>
        {children}
      </AppLayout>
    </Suspense>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ProtectedRoute title="Dashboard"><DashboardPage /></ProtectedRoute>} />
      <Route path="/assets" element={<ProtectedRoute title="Railway Assets"><AssetsPage /></ProtectedRoute>} />
      <Route path="/inspections" element={<ProtectedRoute title="Manage Inspections"><InspectionsPage /></ProtectedRoute>} />
      <Route path="/maintenance" element={<ProtectedRoute title="Maintenance Tasks"><MaintenancePage /></ProtectedRoute>} />
      <Route path="/map" element={<ProtectedRoute title="Asset Map"><MapPage /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute title="Schedule Calendar"><CalendarPage /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute title="Analytics & Trends"><AnalyticsPage /></ProtectedRoute>} />
      <Route path="/predictive" element={<ProtectedRoute title="Predictive Maintenance"><PredictivePage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute title="Reports" allowedRoles={['admin', 'inspector', 'engineer']}><ReportsPage /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute title="Notifications"><NotificationsPage /></ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute title="Team Management" allowedRoles={['admin']}><TeamPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

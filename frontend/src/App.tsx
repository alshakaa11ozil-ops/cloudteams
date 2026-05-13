// src/App.tsx

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
// Toaster renders the actual toast notification DOM element.
// It must be mounted ONCE at the app root — duplicating it causes toasts to appear twice.
import { Toaster } from 'react-hot-toast'
import { ProtectedRoute } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import TeamList from './pages/TeamList'
import CreateTeam from './pages/CreateTeam'
import TeamDashboard from './pages/TeamDashboard'
import TwoFASetup from './pages/TwoFASetup'
import TwoFAChallenge from './pages/TwoFAChallenge'
import JoinTeam from './pages/JoinTeam'
import FileBrowser from './pages/FileBrowser'
import ActivityFeed from './pages/ActivityFeed'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import RecycleBin from './pages/RecycleBin'
import PublicSharePage from './pages/share/PublicSharePage'
import TeamSettings from './pages/TeamSettings'
import UserSettings from './pages/UserSettings'
// Day 2: Collaborative editor — handles both file editing and native documents
import DocumentEditor from './pages/DocumentEditor'
import Members from './pages/Members'
import InviteMember from './pages/InviteMember'


export default function App() {
  return (
    <BrowserRouter>
      {/*
        Toaster sits OUTSIDE <Routes> so it's never unmounted during navigation.
        If it lived inside a route, navigating would unmount it mid-toast.

        position: top-right — industry standard placement, doesn't overlap action buttons
        gutter: 12 — pixels between stacked toasts
        toastOptions: defines default duration and style for all toast types
      */}
      <Toaster
        position="top-right"
        gutter={12}
        toastOptions={{
          // Default duration before auto-dismiss (ms)
          duration: 3500,
          // Success toasts — green check
          success: {
            duration: 3000,
            style: {
              background: '#f0fdf4',   // green-50
              color: '#166534',        // green-800
              border: '1px solid #bbf7d0',  // green-200
              fontSize: '14px',
              fontWeight: '500',
            },
          },
          // Error toasts — red warning
          error: {
            duration: 5000,  // errors stay longer so the user can read them
            style: {
              background: '#fef2f2',   // red-50
              color: '#991b1b',        // red-800
              border: '1px solid #fecaca',  // red-200
              fontSize: '14px',
              fontWeight: '500',
            },
          },
        }}
      />

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/2fa/setup" element={<TwoFASetup />} />
        <Route path="/2fa" element={<TwoFAChallenge />} />

        {/* PUBLIC SHARE ROUTE — NO AUTH REQUIRED */}
        <Route path="/share/:token" element={<PublicSharePage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/join" element={<JoinTeam />} />
          <Route path="/join/:code" element={<JoinTeam />} />
          {/* Real-Time Collaborative Editor (Day 2) */}
          {/*
              Two separate routes — same DocumentEditor component.
              /files/:fileId/edit → editing an existing .txt/.md/.docx file
              /documents/:docId  → editing a native CloudTeams document
              The component reads which params are present to determine mode.
            */}
          <Route path="/teams/:id/files/:fileId/edit" element={<DocumentEditor />} />
          <Route path="/teams/:id/documents/:docId" element={<DocumentEditor />} />

          <Route element={<Layout />}>

            <Route path="/teams" element={<TeamList />} />
            <Route path="/teams/create" element={<CreateTeam />} />
            <Route path="/teams/:id" element={<TeamDashboard />} />
            {/* Week 12 — File Browser */}
            <Route path="/teams/:id/files" element={<FileBrowser />} />
            <Route path="/teams/:id/files/:folderId" element={<FileBrowser />} />

            {/* Week 13 — Collaboration UI */}
            <Route path="/teams/:id/members" element={<Members />} />
            <Route path="/teams/:id/invite" element={<InviteMember />} />
            <Route path="/teams/:id/activity" element={<ActivityFeed />} />
            <Route path="/teams/:id/analytics" element={<AnalyticsDashboard />} />
            <Route path="/teams/:id/recycle-bin" element={<RecycleBin />} />

            {/* Week 14 — Settings & Share (routes added later this week) */}
            <Route path="/teams/:id/settings" element={<TeamSettings />} />
            <Route path="/settings" element={<UserSettings />} />


          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/teams" replace />} />
        <Route path="*" element={
          <div className="p-8 text-red-600">404 — Page not found</div>
        } />
      </Routes>
    </BrowserRouter>
  )
}
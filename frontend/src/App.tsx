// src/App.tsx

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import TeamList from '@/pages/TeamList'
import CreateTeam from '@/pages/CreateTeam'
import TeamDashboard from '@/pages/TeamDashboard'
import TwoFASetup from '@/pages/TwoFASetup'
import TwoFAChallenge from '@/pages/TwoFAChallenge'
import JoinTeam from '@/pages/JoinTeam'
import FileBrowser from '@/pages/FileBrowser'
import ActivityFeed from '@/pages/ActivityFeed'
import AnalyticsDashboard from '@/pages/AnalyticsDashboard'
import RecycleBin from '@/pages/RecycleBin'
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/2fa/setup" element={<TwoFASetup />} />
        <Route path="/2fa" element={<TwoFAChallenge />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/join" element={<JoinTeam />} />
          <Route path="/join/:code" element={<JoinTeam />} />
          <Route element={<Layout />}>
            <Route path="/teams" element={<TeamList />} />
            <Route path="/teams/create" element={<CreateTeam />} />
            <Route path="/teams/:id" element={<TeamDashboard />} />
            {/* Week 12 — File Browser */}
            <Route path="/teams/:id/files" element={<FileBrowser />} />
            <Route path="/teams/:id/files/:folderId" element={<FileBrowser />} />
            
            {/* Week 13 — Collaboration UI */}
            <Route path="/teams/:id/activity" element={<ActivityFeed />} />
            <Route path="/teams/:id/analytics" element={<AnalyticsDashboard />} />
            <Route path="/teams/:id/recycle-bin" element={<RecycleBin />} />
            
            {/* <Route path="/teams/:id/members" element={<MembersPage />} /> */}
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
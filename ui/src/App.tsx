import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { HistoryPage } from '@/pages/HistoryPage'
import { InterceptPage } from '@/pages/InterceptPage'
import { ReplayPage } from '@/pages/ReplayPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ScopePage } from '@/pages/ScopePage'
import { SitemapPage } from '@/pages/SitemapPage'
import { MatchReplacePage } from '@/pages/MatchReplacePage'
import { FlowsPage } from '@/pages/FlowsPage'
import { OrganizerPage } from '@/pages/OrganizerPage'
import { ThemeProvider } from '@/components/ThemeProvider'
import { LauncherPage } from '@/pages/LauncherPage'

// Detect launcher window by presence of the preload bridge (set before any page JS runs)
const isLauncherMode = typeof (window as any).launcher !== 'undefined'

export default function App() {
  if (isLauncherMode) {
    return (
      <ThemeProvider>
        <LauncherPage />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<Navigate to="/history" replace />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/intercept" element={<InterceptPage />} />
            <Route path="/replay" element={<ReplayPage />} />
            <Route path="/flows" element={<FlowsPage />} />
            <Route path="/organizer" element={<OrganizerPage />} />
            <Route path="/sitemap" element={<SitemapPage />} />
            <Route path="/scope" element={<ScopePage />} />
            <Route path="/match-replace" element={<MatchReplacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

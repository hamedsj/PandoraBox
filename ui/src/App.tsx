import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { HistoryPage } from '@/pages/HistoryPage'
import { InterceptPage } from '@/pages/InterceptPage'
import { ReplayPage } from '@/pages/ReplayPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ThemeProvider } from '@/components/ThemeProvider'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<Navigate to="/history" replace />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/intercept" element={<InterceptPage />} />
            <Route path="/replay" element={<ReplayPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import Shell from './Shell.jsx';
import RespondentPage from './views/RespondentPage.jsx';
import StaffPortal from './views/StaffPortal.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/r/:surveyId" element={<RespondentPage />} />
        <Route path="/staff" element={<StaffPortal />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </AuthProvider>
  );
}

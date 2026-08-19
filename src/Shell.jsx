import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AuthView from './views/AuthView.jsx';
import { Icon, Btn, Chip } from './components/index.js';
import { NAV } from './lib/constants.js';
import { fmtDate, relativeDays, remainingLabel, hoursUntil } from './lib/relativeTime.js';

import SurveysListView from './views/SurveysListView.jsx';
import BuilderView from './views/BuilderView.jsx';
import BrandingView from './views/BrandingView.jsx';
import DistributeView from './views/DistributeView.jsx';
import LiveDashboardView from './views/LiveDashboardView.jsx';
import CrossTabView from './views/CrossTabView.jsx';
import SentimentView from './views/SentimentView.jsx';
import CleaningView from './views/CleaningView.jsx';
import UsersView from './views/UsersView.jsx';
import AuditView from './views/AuditView.jsx';
import ConfigView from './views/ConfigView.jsx';

export default function Shell() {
  const { session, profile, tenant, loading, signOut } = useAuth();
  const [view, setView] = useState('surveys');
  const [activeSurveyId, setActiveSurveyId] = useState(null);
  const [search, setSearch] = useState('');
  const role = (profile?.role === 'admin' ? 'admin' : 'creator');

  // sync nav for admin
  useEffect(() => {
    const allowed = (NAV[role] || NAV.creator).flatMap((g) => g.items.map((i) => i.id));
    if (!allowed.includes(view)) setView(allowed[0]);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ALL hooks must run before any early returns (Rules of Hooks)
  const expiryHours = tenant?.expires_at ? hoursUntil(tenant.expires_at) : null;
  const initials = useMemo(() => {
    const name = profile?.full_name || profile?.email || 'U';
    return name.split(' ').filter(Boolean).map((s) => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U';
  }, [profile]);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--ink-mute)' }}>
        Loading…
      </div>
    );
  }
  if (!session) return <AuthView />;

  // Staff sit outside every tenant, so the product has nothing to show
  // them and every query would come back empty. Send them to the console.
  if (session.user?.is_staff) return <Navigate to="/staff" replace />;

  const nav = NAV[role] || NAV.creator;

  const goBuilder = (surveyId) => {
    setActiveSurveyId(surveyId);
    setView('builder');
  };
  const goDistribute = (surveyId) => {
    setActiveSurveyId(surveyId);
    setView('distribute');
  };
  const goLive = (surveyId) => {
    setActiveSurveyId(surveyId);
    setView('live');
  };

  const ctx = { activeSurveyId, setActiveSurveyId, goBuilder, goDistribute, goLive, setView };

  const renderView = () => {
    switch (view) {
      case 'surveys':
        return <SurveysListView ctx={ctx} />;
      case 'builder':
        return <BuilderView ctx={ctx} />;
      case 'branding':
        return <BrandingView ctx={ctx} />;
      case 'distribute':
        return <DistributeView ctx={ctx} />;
      case 'live':
        return <LiveDashboardView ctx={ctx} />;
      case 'crosstab':
        return <CrossTabView ctx={ctx} />;
      case 'sentiment':
        return <SentimentView ctx={ctx} />;
      case 'cleaning':
        return <CleaningView ctx={ctx} />;
      case 'users':
        return <UsersView ctx={ctx} />;
      case 'audit':
        return <AuditView ctx={ctx} />;
      case 'config':
        return <ConfigView ctx={ctx} />;
      default:
        return <SurveysListView ctx={ctx} />;
    }
  };

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-name">
            consumer<em>insights</em>
          </div>
        </div>
        <div className="topbar-search">
          <Icon name="search" size={14} />
          <input
            placeholder="Search surveys, questions, respondents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="topbar-right">
          <Chip tone="positive" pulse>
            {role === 'admin' ? 'Admin' : 'Creator'} · {profile?.username || profile?.full_name || ''}
          </Chip>
          {tenant?.expires_at && (
            <Chip tone={expiryHours !== null && expiryHours <= 48 ? 'warn' : undefined}
                  title={`Evaluation access ends ${fmtDate(tenant.expires_at)}`}>
              {remainingLabel(tenant.expires_at)}
            </Chip>
          )}
          <button className="pill-btn">
            <Icon name="bell" size={13} /> 0
          </button>
          <button className="avatar" title={profile?.full_name || profile?.email}>
            {initials}
          </button>
          <Btn variant="ghost" size="sm" icon="logout" onClick={signOut} title="Sign out">
            Sign out
          </Btn>
        </div>
      </div>

      {/* Sidebar */}
      <div className="sidebar">
        {nav.map((group) => (
          <React.Fragment key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className="nav-item"
                data-active={view === item.id ? 'true' : 'false'}
                onClick={() => setView(item.id)}
              >
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
              </button>
            ))}
          </React.Fragment>
        ))}
        <div className="role-switch">
          <div className="role-switch-label">Role</div>
          <div className="role-switch-buttons" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button data-active={role === 'creator' ? 'true' : 'false'}>Creator</button>
            <button data-active={role === 'admin' ? 'true' : 'false'}>Admin</button>
          </div>
          <div className="small mute" style={{ marginTop: 8, padding: '0 4px' }}>
            Set in profile / system config
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="main">
        {expiryHours !== null && expiryHours <= 48 && (
          <div className="alert" data-tone={expiryHours <= 12 ? 'danger' : 'warn'}
               style={{ margin: '0 0 16px' }}>
            <strong>
              {expiryHours <= 0
                ? 'This evaluation has ended.'
                : `Your evaluation access ends ${relativeDays(tenant.expires_at)}`}
            </strong>{' '}
            {expiryHours > 0 && (
              <>
                — on {fmtDate(tenant.expires_at)}. Export anything you want to keep
                before then; contact your Intelligent Machines representative to extend it.
              </>
            )}
          </div>
        )}
        {renderView()}
      </div>
    </div>
  );
}

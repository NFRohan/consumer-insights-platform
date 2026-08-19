import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Btn, Card, Empty } from '../components/index.js';

const PRESETS = [
  { id: 'ink', name: 'Ink', accent: '#151515', accentInk: '#070709' },
  { id: 'corp', name: 'Corporate blue', accent: '#3D6BD8', accentInk: '#2750A8' },
  { id: 'fresh', name: 'Fresh green', accent: '#0F8A5B', accentInk: '#0B6E48' },
  { id: 'sunset', name: 'Sunset orange', accent: '#F37335', accentInk: '#C45222' },
  { id: 'slate', name: 'Slate', accent: '#5F6B7A', accentInk: '#404A56' },
];

const DEFAULT_CSS = `/* Custom CSS for the respondent-facing survey */\n.respondent-card {\n  border-radius: 16px;\n}\n.qtext {\n  font-weight: 600;\n}\n`;

export default function BrandingView({ ctx }) {
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [survey, setSurvey] = useState(null);

  useEffect(() => {
    supabase
      .from('surveys')
      .select('id,name,branding,status')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSurveys(data || []);
        if (!surveyId && data?.length) setSurveyId(data[0].id);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!surveyId) return;
    supabase
      .from('surveys')
      .select('*')
      .eq('id', surveyId)
      .maybeSingle()
      .then(({ data }) => setSurvey(data));
  }, [surveyId]);

  const setBranding = async (patch) => {
    const next = { ...(survey?.branding || {}), ...patch };
    setSurvey((s) => ({ ...s, branding: next }));
    await supabase.from('surveys').update({ branding: next }).eq('id', surveyId);
  };

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Publish › Branding</div>
            <h1>Branding & White-label</h1>
            <div className="desc">Custom CSS, custom domain, brand colors per survey.</div>
          </div>
        </div>
        <Empty title="No surveys yet" hint="Create a survey first." icon="paint" />
      </div>
    );

  const branding = survey?.branding || {};

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Publish › Branding</div>
          <h1>Branding & White-label</h1>
          <div className="desc">
            Custom CSS for the respondent interface, custom domain (white-label), brand colors. Per
            survey.
          </div>
        </div>
        <select
          className="select"
          value={surveyId || ''}
          onChange={(e) => setSurveyId(e.target.value)}
          style={{ width: 280 }}
        >
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {survey && (
        <div className="split-2-3">
          <div className="col gap-3">
            <Card title="Brand color">
              <div className="col gap-2">
                <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className="chip"
                      data-tone={branding.accent === p.accent ? 'ink' : undefined}
                      onClick={() => setBranding({ accent: p.accent, accentInk: p.accentInk, presetId: p.id })}
                    >
                      <span
                        style={{ width: 10, height: 10, borderRadius: 999, background: p.accent }}
                      />
                      {p.name}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="label">Custom HEX</label>
                  <input
                    className="input"
                    value={branding.accent || ''}
                    onChange={(e) => setBranding({ accent: e.target.value })}
                    placeholder="#151515"
                  />
                </div>
              </div>
            </Card>

            <Card title="Custom domain · CNAME">
              <div className="col gap-2">
                <div>
                  <label className="label">Sub-domain</label>
                  <input
                    className="input"
                    value={branding.subdomain || ''}
                    onChange={(e) => setBranding({ subdomain: e.target.value })}
                    placeholder="surveys.yourcompany.com"
                  />
                </div>
                <div className="alert" data-tone={branding.subdomain ? 'positive' : undefined}>
                  {branding.subdomain
                    ? `Add CNAME → cname.surveyplatform.app for ${branding.subdomain}`
                    : 'Configure a sub-domain to white-label respondent URLs.'}
                </div>
              </div>
            </Card>

            <Card title="Logo & header">
              <div className="col gap-2">
                <div>
                  <label className="label">Logo URL (https)</label>
                  <input
                    className="input"
                    value={branding.logoUrl || ''}
                    onChange={(e) => setBranding({ logoUrl: e.target.value })}
                    placeholder="https://…/logo.png"
                  />
                </div>
                <div>
                  <label className="label">Header tagline</label>
                  <input
                    className="input"
                    value={branding.tagline || ''}
                    onChange={(e) => setBranding({ tagline: e.target.value })}
                    placeholder="We'd love to hear from you"
                  />
                </div>
              </div>
            </Card>
          </div>

          <div className="col gap-3">
            <Card title="Custom CSS">
              <textarea
                className="textarea"
                rows={14}
                value={branding.css ?? DEFAULT_CSS}
                onChange={(e) => setBranding({ css: e.target.value })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="small mute" style={{ marginTop: 6 }}>
                Applied to the respondent-facing survey page only.
              </div>
            </Card>

            <Card title="Live preview">
              <div
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  className="respondent-card"
                  style={{ margin: 0, maxWidth: '100%', boxShadow: 'none', borderColor: 'var(--line)' }}
                >
                  {branding.logoUrl && (
                    <img
                      src={branding.logoUrl}
                      alt=""
                      style={{ height: 28, marginBottom: 12 }}
                    />
                  )}
                  <div className="question-num">Q1 · {survey.name}</div>
                  <div className="qtext">
                    {branding.tagline || 'How likely are you to recommend us?'}
                  </div>
                  <div className="scale-row">
                    {Array.from({ length: 11 }).map((_, i) => (
                      <div
                        key={i}
                        className="scale-btn"
                        style={{
                          background: i === 9 ? branding.accent || 'var(--accent)' : undefined,
                          borderColor: i === 9 ? branding.accent || 'var(--accent)' : undefined,
                          color: i === 9 ? 'white' : undefined,
                        }}
                      >
                        {i}
                      </div>
                    ))}
                  </div>
                </div>
                <style>{branding.css || ''}</style>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

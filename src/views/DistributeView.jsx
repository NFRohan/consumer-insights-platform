import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Btn, Card, Chip, Stat, Empty, Icon, fmt } from '../components/index.js';
import { CHANNELS } from '../lib/constants.js';
import { logAudit } from '../lib/audit.js';

export default function DistributeView({ ctx }) {
  const { profile } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [surveyId, setSurveyId] = useState(ctx.activeSurveyId || null);
  const [survey, setSurvey] = useState(null);
  const [recipients, setRecipients] = useState('');
  const [message, setMessage] = useState(
    'Hi {{name}}, your opinion matters! Take this 2-min survey: {{link}}',
  );
  const [channel, setChannel] = useState('sms');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    supabase
      .from('surveys')
      .select('id,name,status')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSurveys(data || []);
        if (!surveyId && data?.length) setSurveyId(data[0].id);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!surveyId) return;
    supabase.from('surveys').select('*').eq('id', surveyId).maybeSingle().then(({ data }) => setSurvey(data));
    refreshHistory();
  }, [surveyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshHistory = async () => {
    if (!surveyId) return;
    const { data } = await supabase
      .from('distributions')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory(data || []);
  };

  const link = useMemo(() => {
    if (!surveyId) return '';
    const base = window.location.origin;
    return `${base}/r/${surveyId}`;
  }, [surveyId]);

  // Per-batch link. The ?d= is what lets an open be attributed back to
  // this distribution rather than counted as anonymous traffic.
  const trackedLink = (distributionId) => `${link}?d=${distributionId}`;

  const embedSnippet = useMemo(
    () =>
      surveyId
        ? `<iframe src="${link}" width="100%" height="640" style="border:0;border-radius:14px"></iframe>`
        : '',
    [link, surveyId],
  );

  const send = async () => {
    if (!surveyId) return;
    const list = recipients
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const audience = list.length;

    // `sent` is the size of the list we were given, which we do know.
    // `delivered` and `clicked` are not sent at all and are no longer
    // writable through the API: delivered stays unknown until a gateway
    // reports it, and clicked belongs to app.record_click alone. A count
    // this screen could set is a count this screen could invent.
    const { data } = await supabase
      .from('distributions')
      .insert({
        survey_id: surveyId,
        channel,
        message,
        audience_size: audience,
        sent: audience,
        created_by: profile?.id,
      })
      .select()
      .single();

    await logAudit({
      kind: `distribution.${channel}`,
      ref: data?.id,
      detail: `${audience} recipients targeted via ${channel.toUpperCase()}`,
    });
    setRecipients('');
    refreshHistory();
  };

  if (!surveys.length)
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="crumb">Publish › Distribute</div>
            <h1>Distribute</h1>
            <div className="desc">SMS, in-app push, email, embeds, App-in-App.</div>
          </div>
        </div>
        <Empty title="No surveys yet" hint="Create a survey first." icon="send" />
      </div>
    );

  // No `delivered` total: the column is null by design, so summing it
  // would only ever produce a zero dressed up as a measurement.
  const totals = history.reduce(
    (a, d) => ({
      sent: a.sent + (d.sent || 0),
      clicked: a.clicked + (d.clicked || 0),
    }),
    { sent: 0, clicked: 0 },
  );

  // Opens are counted per network client and the link is shareable, so
  // this is a ratio, not a response rate, and it can legitimately exceed
  // the audience. Shown only while it still reads as one.
  const openRate = (opens, audience) =>
    (audience && opens <= audience ? `${Math.round((opens / audience) * 100)}%` : null);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="crumb">Publish › Distribute</div>
          <h1>Distribute</h1>
          <div className="desc">
            SMS, in-app push, email, embed, App-in-App. Track delivery & click status per channel.
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
              {s.name} {s.status === 'live' ? '· LIVE' : ''}
            </option>
          ))}
        </select>
      </div>

      {survey?.status !== 'live' && (
        <div className="alert" data-tone="warn" style={{ marginBottom: 12 }}>
          Survey is currently <strong>{survey?.status}</strong>. Publish it before distributing.
        </div>
      )}

      <div className="split-3" style={{ marginBottom: 16 }}>
        <Stat label="Recipients" value={fmt.num(totals.sent)} delta="from your list" />
        <Stat
          label="Delivered"
          value="—"
          delta="needs a gateway"
        />
        <Stat
          label="Unique opens"
          value={fmt.num(totals.clicked)}
          delta={openRate(totals.clicked, totals.sent)
            ? `${openRate(totals.clicked, totals.sent)} of recipients`
            : 'tracked links only'}
          deltaTone={totals.clicked ? 'positive' : undefined}
        />
      </div>

      <div className="split-2-3">
        <div className="col gap-3">
          <Card title="Public link">
            <div className="row gap-2">
              <input className="input" readOnly value={link} />
              <Btn icon="copy" onClick={() => navigator.clipboard?.writeText(link)}>
                Copy
              </Btn>
              <Btn variant="primary" icon="eye" onClick={() => window.open(link, '_blank')}>
                Open
              </Btn>
            </div>
            <div className="small mute" style={{ marginTop: 6 }}>
              Respondent ID tracked when passed in the URL:{' '}
              <span className="mono">?ref=R-10428</span>
            </div>
          </Card>

          <Card title="Embed snippet">
            <textarea
              className="textarea"
              readOnly
              rows={4}
              value={embedSnippet}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <Btn size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(embedSnippet)}>
                Copy snippet
              </Btn>
              <Chip>Self-contained</Chip>
              <Chip tone="accent">App-in-App ready</Chip>
            </div>
          </Card>
        </div>

        <Card title="Send to participants">
          <div className="col gap-3">
            <div>
              <label className="label">Channel</label>
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {CHANNELS.filter((c) => ['sms', 'push', 'email'].includes(c.id)).map((c) => (
                  <button
                    key={c.id}
                    className="chip"
                    data-tone={channel === c.id ? 'ink' : undefined}
                    onClick={() => setChannel(c.id)}
                  >
                    <Icon name={c.icon} size={11} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">
                {channel === 'sms' || channel === 'push'
                  ? 'Respondent IDs (comma or new-line separated)'
                  : 'Email addresses'}
              </label>
              <textarea
                className="textarea"
                rows={4}
                placeholder={channel === 'email' ? 'a@b.com\nc@d.com' : 'R-10428\nR-10429'}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Message template</label>
              <textarea
                className="textarea"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="small mute" style={{ marginTop: 4 }}>
                Variables: <span className="mono">{`{{name}}`}</span>{' '}
                <span className="mono">{`{{link}}`}</span>{' '}
                <span className="mono">{`{{survey}}`}</span>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small mute">
                Recipients:{' '}
                <strong>
                  {recipients.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).length}
                </strong>
              </span>
              <Btn variant="primary" icon="send" onClick={send} disabled={!recipients.trim()}>
                Send via {channel.toUpperCase()}
              </Btn>
            </div>
            <div className="alert">
              <strong>No gateway is connected.</strong> Sending records the batch and issues a
              tracked link; it does not deliver messages. Opens of that link are counted for
              real — delivery receipts need an SMS or push provider.
            </div>
          </div>
        </Card>
      </div>

      <div style={{ height: 16 }} />
      <Card title="Distribution history" sub={`${history.length} batches`}>
        {history.length === 0 ? (
          <Empty title="No distributions yet" hint="Send your first batch above." icon="send" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>Recipients</th>
                <th>Unique opens</th>
                <th>Tracked link</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d) => (
                <tr key={d.id}>
                  <td className="small mute">{new Date(d.created_at).toLocaleString()}</td>
                  <td>
                    <Chip tone="accent">{d.channel.toUpperCase()}</Chip>
                  </td>
                  <td className="mono">{fmt.num(d.audience_size)}</td>
                  <td className="mono">
                    {fmt.num(d.clicked || 0)}{' '}
                    <span className="mute small">
                      {openRate(d.clicked || 0, d.audience_size)
                        ? `(${openRate(d.clicked || 0, d.audience_size)})`
                        : ''}
                    </span>
                  </td>
                  <td>
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      title={trackedLink(d.id)}
                      onClick={() => navigator.clipboard?.writeText(trackedLink(d.id))}
                    >
                      Copy
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

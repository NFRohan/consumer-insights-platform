import React from 'react';
import Icon from './Icon.jsx';

export const Btn = ({ children, variant, size, icon, iconRight, ...rest }) => (
  <button className="btn" data-variant={variant} data-size={size} {...rest}>
    {icon && <Icon name={icon} size={14} />}
    {children}
    {iconRight && <Icon name={iconRight} size={14} />}
  </button>
);

export const Chip = ({ children, tone, pulse, ...rest }) => (
  <span className="chip" data-tone={tone} data-pulse={pulse ? 'true' : undefined} {...rest}>
    {pulse && <span className="dot" />}
    {children}
  </span>
);

export const Card = ({ title, sub, action, children, pad = true, className = '' }) => (
  <div className={`card ${className}`}>
    {(title || action) && (
      <div className="card-head">
        <div>
          {title && <h3>{title}</h3>}
          {sub && <div className="sub">{sub}</div>}
        </div>
        {action}
      </div>
    )}
    <div className={pad ? 'card-pad' : ''}>{children}</div>
  </div>
);

export const Stat = ({ label, value, delta, deltaTone }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {delta && (
      <div className="stat-delta" data-tone={deltaTone}>
        {delta}
      </div>
    )}
  </div>
);

export const Switch = ({ on, onChange }) => (
  <button className="switch" data-on={on ? 'true' : 'false'} onClick={() => onChange(!on)} />
);

export const ProgressBar = ({ value, max = 100 }) => (
  <div className="progress">
    <div
      className="progress-fill"
      style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
    />
  </div>
);

export const Empty = ({ icon = 'list', title, hint }) => (
  <div className="empty">
    <div className="empty-mark">
      <Icon name={icon} size={18} />
    </div>
    <div style={{ fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 4 }}>{title}</div>
    {hint && <div className="small mute">{hint}</div>}
  </div>
);

export const fmt = {
  num: (n) => (n ?? 0).toLocaleString('en-US'),
  pct: (n, dp = 1) => `${(n * 100).toFixed(dp)}%`,
  short: (n) => {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  },
};

export const Sparkline = ({ data, w = 120, h = 32, stroke = 'var(--accent)' }) => {
  if (!data || data.length === 0) return <svg width={w} height={h} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = h - ((d - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

export const Donut = ({ pos = 0.5, neu = 0.3, neg = 0.2, size = 60 }) => {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;
  const seg = (val, color, key) => {
    const len = c * val;
    const e = (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    );
    offset += len;
    return e;
  };
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      {seg(pos, 'oklch(0.62 0.14 152)', 'pos')}
      {seg(neu, 'oklch(0.78 0.04 248)', 'neu')}
      {seg(neg, 'oklch(0.58 0.18 25)', 'neg')}
    </svg>
  );
};

export const Bars = ({ data, height = 80, color = 'var(--accent)' }) => {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {data.map((d, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
          title={`${d.l}: ${d.v}`}
        >
          <div
            style={{
              width: '100%',
              height: `${(d.v / max) * 100}%`,
              background: color,
              borderRadius: 3,
              minHeight: 2,
              transition: 'height 200ms ease',
            }}
          />
          <div className="tiny mute" style={{ fontSize: 9.5 }}>
            {d.l}
          </div>
        </div>
      ))}
    </div>
  );
};

export const Funnel = ({ data }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.n));
  return (
    <div className="col gap-2" style={{ width: '100%' }}>
      {data.map((d, i) => {
        const pct = (d.n / max) * 100;
        const dropFromPrev = i === 0 ? null : 1 - d.n / data[i - 1].n;
        return (
          <div key={i}>
            <div
              className="row"
              style={{ justifyContent: 'space-between', marginBottom: 4 }}
            >
              <div className="small" style={{ fontWeight: 500 }}>
                {d.label}
              </div>
              <div className="row gap-2">
                {dropFromPrev !== null && dropFromPrev > 0 && (
                  <span className="tiny mute">−{(dropFromPrev * 100).toFixed(1)}%</span>
                )}
                <span className="tiny mono">{(d.n ?? 0).toLocaleString()}</span>
              </div>
            </div>
            <div
              style={{
                height: 16,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background:
                    'linear-gradient(90deg, var(--accent), color-mix(in oklch, var(--accent) 70%, white))',
                  transition: 'width 320ms ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

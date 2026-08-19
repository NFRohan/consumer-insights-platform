// Question type catalogue (from BRD §7.2 Customizable Question Types)
export const QUESTION_TYPES = [
  { id: 'single', label: 'Single Select', group: 'Closed', glyph: '◉' },
  { id: 'multi', label: 'Multi Select', group: 'Closed', glyph: '☑' },
  { id: 'dropdown', label: 'Dropdown', group: 'Closed', glyph: '▾' },
  { id: 'matrix', label: 'Matrix / Grid', group: 'Matrix', glyph: '▦' },
  { id: 'rating', label: 'Rating Scale', group: 'Scales', glyph: '★' },
  { id: 'slider', label: 'Slider', group: 'Scales', glyph: '⎯' },
  { id: 'rank', label: 'Drag & Drop Rank', group: 'Ranking', glyph: '⇅' },
  { id: 'text', label: 'Open Text', group: 'Open', glyph: '¶' },
  { id: 'video', label: 'Video Stimulus', group: 'Media', glyph: '▶' },
  { id: 'hotspot', label: 'Hotspot / Click Map', group: 'Media', glyph: '◎' },
  { id: 'image-opt', label: 'Image Options', group: 'Media', glyph: '▣' },
  { id: 'iat', label: 'Reaction Time (IAT)', group: 'Behavioral', glyph: '⏱' },
  { id: 'fill', label: 'Fill in the Blanks', group: 'Behavioral', glyph: '⌧' },
  { id: 'audio', label: 'Audio Response', group: 'Behavioral', glyph: '◌' },
  { id: 'nps', label: 'Net Promoter Score', group: 'Templates', glyph: 'NPS' },
  { id: 'constant-sum', label: 'Constant Sum', group: 'Templates', glyph: '∑' },
];

export const NAV = {
  creator: [
    {
      section: 'Build',
      items: [
        { id: 'surveys', label: 'Surveys', icon: 'list' },
        { id: 'builder', label: 'Builder', icon: 'edit' },
      ],
    },
    {
      section: 'Publish',
      items: [
        { id: 'branding', label: 'Branding', icon: 'paint' },
        { id: 'distribute', label: 'Distribute', icon: 'send' },
      ],
    },
    {
      section: 'Analyze',
      items: [
        { id: 'live', label: 'Live dashboard', icon: 'chart', badge: 'LIVE' },
        { id: 'crosstab', label: 'Cross-tab', icon: 'pie' },
        { id: 'sentiment', label: 'Sentiment', icon: 'sparkle' },
        { id: 'cleaning', label: 'Data cleaning', icon: 'broom' },
      ],
    },
  ],
  admin: [
    {
      section: 'Admin',
      items: [
        { id: 'users', label: 'Users & roles', icon: 'users' },
        { id: 'audit', label: 'Audit log', icon: 'log' },
        { id: 'config', label: 'System config', icon: 'gear' },
      ],
    },
    {
      section: 'Build',
      items: [{ id: 'surveys', label: 'All surveys', icon: 'list' }],
    },
  ],
};

export const DEFAULT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'bn', label: 'Bangla' },
  { code: 'banglish', label: 'Banglish' },
];

export const CHANNELS = [
  { id: 'sms', label: 'SMS', icon: 'phone' },
  { id: 'push', label: 'In-App Push', icon: 'bell' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'link', label: 'Public link', icon: 'link' },
  { id: 'embed', label: 'Embed snippet', icon: 'code' },
  { id: 'app-in-app', label: 'App-in-App', icon: 'globe' },
];

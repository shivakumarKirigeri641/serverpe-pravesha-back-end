/**
 * permissions.js — what each role may see and do in the admin panel.
 *
 * ONE MAP, USED TWICE. The API guards every route with these capabilities, and
 * the panel builds its navigation from the same list, so a menu can never offer
 * a screen whose API would refuse it, and hiding a menu item is never the only
 * thing standing between a role and an action.
 *
 * NOT EVERYONE GETS EVERYTHING. A viewer reads; finance sees money; a checkpost
 * manager runs the gate and its people; an admin runs the service; only a super
 * administrator manages panel users and GST — the two things that, done wrong,
 * are hardest to undo.
 *
 * Checkpost staff are not a panel role. They use the gate app, which can only
 * verify a vehicle, show the vehicle in hand and their own activity — exactly
 * the permissions asked of that role — and nothing else exists there to grant.
 */

const CAPABILITIES = {
  'dashboard.view': 'See the dashboard',
  'live.view': 'Watch live monitoring',
  'analytics.view': 'Use data analytics',
  'reports.view': 'Generate operational reports',
  'finance.view': 'See revenue, GST and the financial split',
  'finance.expenses': 'Record expenses and input tax credit',
  'finance.remit': 'Record remittances to the Tourism Department',
  'conversations.view': 'Read WhatsApp conversations (numbers masked)',
  'conversations.technical': 'See full numbers and technical identifiers',
  'alerts.view': 'See operational alerts',
  'alerts.act': 'Acknowledge alerts',
  'announcements.manage': 'Publish announcements and closures',
  'negative.view': 'See negative tracking',
  'negative.act': 'Review, dismiss and escalate negative activity',
  'visitors.block': 'Block and unblock visitor numbers',
  'tickets.view': 'Search and open any pass',
  'tickets.cancel': 'Cancel a pass',
  'tickets.resend': 'Send a pass to the visitor again',
  'tickets.free': 'Issue free passes',
  'tickets.onspot': 'Sell on-spot passes',
  'destinations.view': 'See destinations and checkposts',
  'destinations.manage': 'Add and change destinations and checkposts',
  'settings.pricing': 'Change prices and the service fee',
  'settings.slots': 'Create, change and remove slots and capacity',
  'settings.staff': 'Manage checkpost staff',
  'settings.users': 'Manage panel users and their roles',
  'settings.gst': 'Change GST and business details',
  'health.view': 'See system health',
  'audit.view': 'Read the audit log',
};

const ALL = Object.keys(CAPABILITIES);

const ROLES = {
  super_admin: {
    label: 'Super Admin',
    description: 'Everything, including panel users and GST.',
    can: ALL,
  },
  admin: {
    label: 'Admin',
    description: 'Runs the service: everything except panel users and GST.',
    can: ALL.filter((c) => !['settings.users', 'settings.gst'].includes(c)),
  },
  checkpost_manager: {
    label: 'Checkpost Manager',
    description: 'Runs the gate: live activity, negative tracking, staff and on-spot passes.',
    can: ['dashboard.view', 'live.view', 'reports.view', 'conversations.view', 'negative.view', 'negative.act',
      'tickets.view', 'tickets.resend', 'tickets.onspot', 'settings.staff', 'alerts.view', 'alerts.act', 'destinations.view', 'health.view'],
  },
  finance: {
    label: 'Finance',
    description: 'Revenue, GST, reports and the audit log.',
    can: ['dashboard.view', 'analytics.view', 'reports.view', 'finance.view', 'finance.expenses', 'finance.remit',
      'tickets.view', 'alerts.view', 'destinations.view', 'health.view', 'audit.view'],
  },
  viewer: {
    label: 'Viewer',
    description: 'Reads the dashboard, live monitoring, analytics and reports.',
    can: ['dashboard.view', 'live.view', 'analytics.view', 'reports.view', 'tickets.view', 'alerts.view', 'destinations.view', 'health.view'],
  },
};

/* An older role name still found on rows created before 035. */
ROLES.department = { ...ROLES.checkpost_manager, label: 'Department (legacy)' };

/* The names the first screens were written against, kept working. */
const LEGACY = {
  operate: 'negative.act',
  configure: 'conversations.technical',
  manage_staff: 'settings.staff',
  read_personal: 'conversations.view',
};

const can = (role, capability) => {
  const cap = LEGACY[capability] || capability;
  return Boolean(ROLES[role] && ROLES[role].can.includes(cap));
};

const capabilitiesOf = (role) => (ROLES[role] ? [...ROLES[role].can] : []);

/** The matrix, for the permissions screen. */
function matrix() {
  const roles = ['super_admin', 'admin', 'checkpost_manager', 'finance', 'viewer'];
  return {
    roles: roles.map((key) => ({ key, label: ROLES[key].label, description: ROLES[key].description })),
    capabilities: Object.entries(CAPABILITIES).map(([key, label]) => ({
      key, label, granted: Object.fromEntries(roles.map((r) => [r, ROLES[r].can.includes(key)])),
    })),
    gateStaff: {
      label: 'Checkpost Staff',
      description: 'Gate app only: verify a vehicle, see the vehicle being checked, and their own activity.',
    },
  };
}

module.exports = { CAPABILITIES, ROLES, can, capabilitiesOf, matrix };

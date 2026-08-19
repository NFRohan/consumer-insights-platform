// =====================================================================
// Change an existing staff account's username and/or password.
//
//   printf %s 'the-new-password' \
//     | node --env-file=.env scripts/staff-credentials.mjs <current-username> \
//           [--username <new>] [--full-name "New Name"]
//
// The password is read from STDIN, never from argv: arguments show up in
// shell history and in the process list, and a password is likely to
// contain characters the shell would otherwise try to interpret.
//
// This UPDATES the existing row rather than creating a replacement.
// staff_audit.actor_id references app_users ON DELETE SET NULL, so
// deleting an account to re-make it silently unattributes every action
// it ever took.
// =====================================================================

import { queryAsStaff, getPool } from '../api/_lib/db.js';
import { hashPassword } from '../api/_lib/auth.js';

const argv = process.argv.slice(2);
const current = argv[0];
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
};

if (!current || current.startsWith('--')) {
  console.error('usage: <current-username> [--username <new>] [--full-name "..."]');
  console.error('       the new password is read from stdin');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (use node --env-file=.env)');
  process.exit(1);
}

async function readStdin() {
  if (process.stdin.isTTY) return null;      // nothing piped in
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  // Strip one trailing newline, which the shell adds and the user did
  // not type. Everything else is kept: a password may legitimately end
  // in a space or a symbol.
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

try {
  const password = await readStdin();
  const newUsername = flag('username');
  const newFullName = flag('full-name');

  if (!password && !newUsername && !newFullName) {
    console.error('nothing to change: pipe a password in, or pass --username / --full-name');
    process.exit(1);
  }
  if (password !== null && password.length > 0 && password.length < 12) {
    console.error('password must be at least 12 characters');
    process.exit(1);
  }

  const [account] = await queryAsStaff(
    `select id, username, full_name from public.app_users
      where lower(username) = lower($1) and is_staff = true`,
    [current],
  );
  if (!account) {
    console.error(`no staff account named "${current}"`);
    process.exit(1);
  }

  if (newUsername) {
    const clash = await queryAsStaff(
      `select 1 from public.app_users
        where lower(username) = lower($1) and id <> $2`,
      [newUsername, account.id],
    );
    if (clash.length) {
      console.error(`"${newUsername}" is already taken`);
      process.exit(1);
    }
  }

  const [updated] = await queryAsStaff(
    `update public.app_users
        set username      = coalesce($2, username),
            full_name     = coalesce($3, full_name),
            password_hash = coalesce($4, password_hash),
            must_change_pw = false
      where id = $1
      returning username, full_name`,
    [account.id, newUsername, newFullName, password ? await hashPassword(password) : null],
  );

  console.log('\nStaff credentials updated.\n');
  if (newUsername && newUsername.toLowerCase() !== account.username.toLowerCase()) {
    console.log(`  username  ${account.username} -> ${updated.username}`);
  } else {
    console.log(`  username  ${updated.username}`);
  }
  console.log(`  password  ${password ? 'changed' : 'unchanged'}`);
  console.log(`  name      ${updated.full_name}`);
  console.log('\nExisting sessions keep working until they expire; the audit');
  console.log('trail still points at this same account.\n');
} finally {
  await getPool().end();
}

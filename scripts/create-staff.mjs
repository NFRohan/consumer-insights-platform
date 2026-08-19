// =====================================================================
// Create an Intelligent Machines staff account.
//
// Staff sit outside every tenant (tenant_id null, is_staff true) and are
// the only accounts that can reach the admin portal. There is no
// self-service path to becoming one — this script is it.
//
//   DATABASE_URL=... node scripts/create-staff.mjs <username> [full name]
//
// The password is generated and printed once.
// =====================================================================

import { queryAsStaff, getPool } from '../api/_lib/db.js';
import { hashPassword, generatePassword } from '../api/_lib/auth.js';

const [, , username, ...nameParts] = process.argv;

if (!username) {
  console.error('usage: node scripts/create-staff.mjs <username> [full name]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const fullName = nameParts.join(' ') || username;

try {
  const existing = await queryAsStaff(
    `select id, is_staff from public.app_users where lower(username) = lower($1)`,
    [username],
  );
  if (existing.length) {
    console.error(`"${username}" already exists`);
    process.exit(1);
  }

  const password = generatePassword();
  await queryAsStaff(
    `insert into public.app_users
       (tenant_id, username, password_hash, full_name, role, is_staff, status)
     values (null, $1, $2, $3, 'admin', true, 'active')`,
    [username, await hashPassword(password), fullName],
  );

  console.log('\nStaff account created.\n');
  console.log(`  username  ${username}`);
  console.log(`  password  ${password}`);
  console.log('\nStored as a hash — this is the only time it is shown.');
  console.log('Sign in at /staff\n');
} finally {
  await getPool().end();
}

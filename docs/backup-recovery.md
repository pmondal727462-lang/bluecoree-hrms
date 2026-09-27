# Backup and disaster recovery

## What a backup is

`npm run backup -- daily|weekly|manual` takes a full logical backup of the PostgreSQL database with `pg_dump --format=custom`. The dump is streamed straight into AES-256-GCM encryption, so no unencrypted dump touches the disk. Each run then:

1. Writes `hrms-<kind>-<timestamp>.hrmsbak` to `BACKUP_DIR` (default `data/backups`, outside the web root) with owner-only file permissions.
2. Records size and SHA-256 checksum in `backup_logs`.
3. **Verifies** the file by decrypting it (which checks the GCM authentication tag) and listing its contents with `pg_restore --list`. A backup is marked `SUCCESS` only after verification.
4. With `--restore-test`, **restores** it into a temporary database, checks that tables were created, then drops that database.
5. Deletes backups past their retention (`BACKUP_DAILY_RETENTION_DAYS`, default 7; `BACKUP_WEEKLY_RETENTION_DAYS`, default 35) and stale partial files.

Daily and weekly backups are both full backups. They differ in schedule and retention. Uploaded files, if a file store is added later, need their own backup.

Super Admins can see the last backup, status, size, location, verification result and next scheduled runs under **Platform → Backups**.

## Keys

`BACKUP_ENCRYPTION_KEY` is a separate 32-byte hex key (`npm run env:init` generates one for new installs). **Store a copy outside the server**, for example in a password manager or secrets manager. Without it, backups cannot be restored. Do not store the key alongside the backup files.

## Scheduling

The application does not schedule backups by itself.

**Windows (Task Scheduler)**, run from the project folder in an administrator PowerShell:

```powershell
$dir = (Get-Location).Path
$daily = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "run backup -- daily" -WorkingDirectory $dir
Register-ScheduledTask -TaskName "HRMS daily backup" -Action $daily -Trigger (New-ScheduledTaskTrigger -Daily -At 2am)
$weekly = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "run backup -- weekly --restore-test" -WorkingDirectory $dir
Register-ScheduledTask -TaskName "HRMS weekly backup" -Action $weekly -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am)
```

**Linux (cron)**:

```cron
0 2 * * *  cd /srv/hrms && npm run backup -- daily
0 3 * * 0  cd /srv/hrms && npm run backup -- weekly --restore-test
* * * * *  cd /srv/hrms && npm run webhooks:deliver
```

Keep `BACKUP_DAILY_AT` and `BACKUP_WEEKLY_DAY` (0 = Sunday) in line with the schedule so the admin screen shows the correct next run.

**Off-site copies.** Copy `BACKUP_DIR` to separate storage (another region or provider) after each run. Encrypted files are safe to store off-site, provided the key is kept separately.

## Restore procedure

1. Stop the application, or put it in maintenance, so no new writes happen.
2. Create an empty database: `createdb -U hrms hrms_restored`.
3. Restore: `npm run backup:restore -- data/backups/<file>.hrmsbak hrms_restored`. The file is decrypted as a stream, and restore aborts on the first error.
4. Point `DATABASE_URL`, `APP_DATABASE_URL` and `SYSTEM_DATABASE_URL` at the restored database, or rename databases, then run `npm run db:migrate` (a no-op if the backup came from the same version) and `npm run db:roles`. Restores skip grants, so the target cluster does not need the runtime roles beforehand. `db:roles` creates the roles if needed and grants them access. Row-level security policies are restored with the tables.
5. Start the application, sign in as an administrator, and check recent records and the audit trail.

**Targets to agree with the business:** the recovery point objective with daily backups is up to 24 hours of data loss. Add PostgreSQL WAL archiving or managed point-in-time recovery if that is too much. The recovery time objective depends on database size; measure it during restore drills.

## Restore testing

- Weekly: the scheduled `--restore-test` run proves each weekly backup can be restored.
- Quarterly: a full drill on a separate machine, using the off-site copy and the separately stored key. Record the time taken and any problems.

## Disaster scenarios

| Scenario | Response |
|---|---|
| Accidental deletion or bad data change | Restore the latest good backup into a separate database and copy the affected records back. Do not overwrite production. |
| Database server lost | Provision PostgreSQL 18, restore the latest off-site backup, update `DATABASE_URL`, redeploy. |
| Application server lost | Redeploy the code, restore `.env` secrets from the secrets manager; the database is unaffected. |
| Backup key lost | Existing backups cannot be decrypted. Generate a new key, take a fresh backup immediately, and store the key off-server. |
| Ransomware or compromise | Isolate systems, rotate all secrets (JWT, encryption, API keys, webhook secrets), restore from an off-site backup taken before the compromise. |

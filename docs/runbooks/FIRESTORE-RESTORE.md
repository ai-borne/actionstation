# Firestore Backup and Restore

> **Status: Current** · Last reconciled: 2026-09-25 (checked against checklist C4 (bucket, schedule, retention, alert)). Update this line whenever you re-verify the doc against the code or live system.

Daily export of the `(default)` database to a retention-protected bucket.

| Item | Value |
|------|-------|
| Job | Cloud Scheduler `firebase-schedule-firestoreBackup-us-central1`, 02:00 UTC daily |
| Function | `firestoreBackup` (gen2, runs as the default compute service account) |
| Bucket | `gs://actionstation-244f0-firestore-backups-immutable` (us-central1, versioned, 30-day retention) |
| Path | `gs://…-immutable/YYYY-MM-DD/` |
| Alert | `HIGH: Firestore Backup Failed` (log metric `firestore_backup_failed`) |
| Setup | `scripts/setup-immutable-backups.sh`, `scripts/setup-monitoring-alerts.sh` (both idempotent) |

Always pass `--project=actionstation-244f0`; the default gcloud project on the maintainer machine is a different one.

## Check that backups are running

```bash
gcloud storage ls gs://actionstation-244f0-firestore-backups-immutable/
gcloud firestore operations list --project=actionstation-244f0 \
  --format="table(name.basename(),metadata.operationState,metadata.outputUriPrefix)"
gcloud scheduler jobs describe firebase-schedule-firestoreBackup-us-central1 \
  --location=us-central1 --project=actionstation-244f0 --format="value(lastAttemptTime,status.code)"
```

A `status.code` of `13` means the last run failed. Read the logs for the `firestorebackup` Cloud Run service.

Run a backup on demand:

```bash
gcloud scheduler jobs run firebase-schedule-firestoreBackup-us-central1 \
  --location=us-central1 --project=actionstation-244f0
```

## Known failure: `403 PERMISSION_DENIED`

The function runs as `<project-number>-compute@developer.gserviceaccount.com`. That account needs
`roles/datastore.importExportAdmin`; the appspot account needs write access to the bucket. Re-run
`scripts/setup-immutable-backups.sh` to restore both. Project IAM changes can take a few minutes.

## Restore drill (never restore into `(default)` to test)

Restore into a scratch database, compare, then delete it. Run this once per quarter and after any backup change.

```bash
P=actionstation-244f0; DAY=YYYY-MM-DD
gcloud firestore databases create --database=restore-drill --location=us-central1 --type=firestore-native --project=$P
gcloud firestore import gs://$P-firestore-backups-immutable/$DAY --database=restore-drill --project=$P
```

Compare collection-group counts between `(default)` and `restore-drill` with the
`documents:runAggregationQuery` REST call for `workspaces`, `nodes`, `edges`, `knowledgeBank`, `usage`
(counts differ only by writes made after the backup). Then clean up:

```bash
gcloud firestore databases delete --database=restore-drill --project=$P --quiet
```

## Real disaster recovery

1. Stop writes: put the app in maintenance, or deploy rules that deny all writes.
2. Restore the chosen day into a **new** database, verify it as above.
3. Either point the app at the new database, or import into `(default)` (import merges and overwrites
   documents with the same path; it does not delete documents created after the backup).
4. Re-enable writes and record the incident.

## Retention lock (irreversible)

The 30-day retention policy is set but **unlocked** until a human decides otherwise. Locking is permanent:
nobody can shorten or remove it, and the bucket cannot be deleted until all objects expire. Lock only after
a successful backup and restore drill:

```bash
gcloud storage buckets update gs://actionstation-244f0-firestore-backups-immutable --lock-retention-period
```

## Drill log

| Date | Backup | Result |
|------|--------|--------|
| 2026-09-20 | `2026-09-20` (338 docs, ~925 KB) | Restored into scratch DB; workspaces 21, nodes 185, edges 84, knowledgeBank 33, usage 1 all matched `(default)`; scratch DB deleted |

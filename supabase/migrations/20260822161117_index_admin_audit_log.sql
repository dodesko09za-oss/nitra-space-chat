create index if not exists admin_audit_log_admin_created_idx
  on private.admin_audit_log(admin_user_id, created_at desc);

create index if not exists admin_audit_log_target_created_idx
  on private.admin_audit_log(target_user_id, created_at desc);

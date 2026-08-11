INSERT INTO library_security_principals (user_id,email,account_status,session_status)
VALUES ('golden-e2e-user','golden-e2e@local.invalid','Active','Active')
ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,account_status='Active',session_status='Active';

INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by)
VALUES ('librarygrant_golden_e2e','golden-e2e-user','Library Manager','Active','golden-e2e-setup')
ON CONFLICT(id) DO UPDATE SET permission='Library Manager',status='Active';

INSERT INTO organizations (id,name,status,owner_user_id)
VALUES ('golden-e2e-organization','Golden E2E Organization','Active','golden-e2e-user')
ON CONFLICT(id) DO UPDATE SET status='Active',owner_user_id='golden-e2e-user';

INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by)
VALUES ('membership_golden_e2e','golden-e2e-organization','golden-e2e-user','Active','golden-e2e-setup')
ON CONFLICT(id) DO UPDATE SET status='Active',revoked_at=NULL;

INSERT INTO organization_membership_roles (id,membership_id,role,status,granted_by)
VALUES
  ('membershiprole_golden_owner','membership_golden_e2e','Organization Owner','Active','golden-e2e-setup'),
  ('membershiprole_golden_admin','membership_golden_e2e','Organization Administrator','Active','golden-e2e-setup')
ON CONFLICT(id) DO UPDATE SET status='Active',revoked_at=NULL;

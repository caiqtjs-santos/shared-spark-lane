CREATE TABLE public.enterprise_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enterprise_name TEXT,
  default_policy_name TEXT,
  pending_state TEXT,
  pending_signup_url_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.enterprise_config TO authenticated;
GRANT ALL ON public.enterprise_config TO service_role;
ALTER TABLE public.enterprise_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enterprise_config_select_ti" ON public.enterprise_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'ti'));

ALTER TABLE public.devices
  ADD COLUMN android_enrollment_token_name TEXT,
  ADD COLUMN android_enrollment_token_value TEXT,
  ADD COLUMN android_enrollment_qr_png TEXT,
  ADD COLUMN android_enrollment_expires_at TIMESTAMPTZ,
  ADD COLUMN android_management_device_name TEXT;
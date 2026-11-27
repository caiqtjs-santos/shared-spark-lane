import type { Database as GeneratedDatabase } from "@/integrations/supabase/types";

type GeneratedDevices = GeneratedDatabase["public"]["Tables"]["devices"];

// The configured backend includes these migrations, while the managed
// generator describes the separate Lovable Cloud schema. Keep its output intact.
type Devices = Omit<GeneratedDevices, "Row" | "Insert" | "Update"> & {
  Row: GeneratedDevices["Row"] & {
    professional_name: string | null;
    device_owner: boolean;
    access_token: string;
  };
  Insert: GeneratedDevices["Insert"] & {
    professional_name?: string | null;
    device_owner?: boolean;
    access_token?: string;
  };
  Update: GeneratedDevices["Update"] & {
    professional_name?: string | null;
    device_owner?: boolean;
    access_token?: string;
  };
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: Omit<GeneratedDatabase["public"]["Tables"], "devices"> & {
      devices: Devices;
    };
  };
};
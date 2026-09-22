export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_sessions: {
        Row: {
          device_id: string
          ended_at: string | null
          id: string
          mode: string
          reason: string
          requested_by_user_id: string
          started_at: string
          status: string
        }
        Insert: {
          device_id: string
          ended_at?: string | null
          id?: string
          mode: string
          reason: string
          requested_by_user_id: string
          started_at?: string
          status?: string
        }
        Update: {
          device_id?: string
          ended_at?: string | null
          id?: string
          mode?: string
          reason?: string
          requested_by_user_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          created_at: string
          details: Json | null
          device_id: string | null
          event_type: string
          id: string
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          device_id?: string | null
          event_type: string
          id?: string
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          device_id?: string | null
          event_type?: string
          id?: string
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "access_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          android_enrollment_expires_at: string | null
          android_enrollment_qr_png: string | null
          android_enrollment_token_name: string | null
          android_enrollment_token_value: string | null
          android_management_device_name: string | null
          battery_level: number | null
          created_at: string
          device_secret: string | null
          enrolled_at: string | null
          enrolled_by_user_id: string | null
          enrollment_status: string
          enrollment_token: string | null
          id: string
          last_seen_at: string | null
          model: string
          name: string
          owner_user_id: string | null
          push_token: string | null
        }
        Insert: {
          android_enrollment_expires_at?: string | null
          android_enrollment_qr_png?: string | null
          android_enrollment_token_name?: string | null
          android_enrollment_token_value?: string | null
          android_management_device_name?: string | null
          battery_level?: number | null
          created_at?: string
          device_secret?: string | null
          enrolled_at?: string | null
          enrolled_by_user_id?: string | null
          enrollment_status?: string
          enrollment_token?: string | null
          id?: string
          last_seen_at?: string | null
          model: string
          name: string
          owner_user_id?: string | null
          push_token?: string | null
        }
        Update: {
          android_enrollment_expires_at?: string | null
          android_enrollment_qr_png?: string | null
          android_enrollment_token_name?: string | null
          android_enrollment_token_value?: string | null
          android_management_device_name?: string | null
          battery_level?: number | null
          created_at?: string
          device_secret?: string | null
          enrolled_at?: string | null
          enrolled_by_user_id?: string | null
          enrollment_status?: string
          enrollment_token?: string | null
          id?: string
          last_seen_at?: string | null
          model?: string
          name?: string
          owner_user_id?: string | null
          push_token?: string | null
        }
        Relationships: []
      }
      enterprise_config: {
        Row: {
          created_at: string
          default_policy_name: string | null
          enterprise_name: string | null
          id: boolean
          pending_signup_url_name: string | null
          pending_state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_policy_name?: string | null
          enterprise_name?: string | null
          id?: boolean
          pending_signup_url_name?: string | null
          pending_state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_policy_name?: string | null
          enterprise_name?: string | null
          id?: boolean
          pending_signup_url_name?: string | null
          pending_state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          login_code: string
          name: string
        }
        Insert: {
          created_at?: string
          id: string
          login_code: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          login_code?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "profissional" | "ti"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["profissional", "ti"],
    },
  },
} as const

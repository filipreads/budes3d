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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          locale: string
          message: string
          name: string
          order_number: string | null
          status: string
          topic: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          locale?: string
          message: string
          name: string
          order_number?: string | null
          status?: string
          topic?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          locale?: string
          message?: string
          name?: string
          order_number?: string | null
          status?: string
          topic?: string
          user_id?: string | null
        }
        Relationships: []
      }
      order_downloads: {
        Row: {
          created_at: string
          download_count: number
          expires_at: string
          file_format: string
          id: string
          label: string
          order_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          download_count?: number
          expires_at?: string
          file_format?: string
          id?: string
          label?: string
          order_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          download_count?: number
          expires_at?: string
          file_format?: string
          id?: string
          label?: string
          order_id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_downloads_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_emails: {
        Row: {
          body_html: string
          created_at: string
          error: string | null
          id: string
          locale: string
          order_id: string | null
          sent_at: string | null
          status: string
          subject: string
          template: string
          to_email: string
          updated_at: string
        }
        Insert: {
          body_html: string
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          order_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          template: string
          to_email: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          order_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template?: string
          to_email?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_emails_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          config_snapshot: Json
          contact_email: string | null
          created_at: string
          currency: string
          delivery_type: string
          fulfilment_status: string
          id: string
          line_items: Json
          order_number: string
          paid_at: string | null
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string
          project_id: string | null
          share_enabled: boolean
          share_token: string | null
          shipping_address: Json | null
          shipping_cents: number
          subtotal_cents: number
          total_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          config_snapshot?: Json
          contact_email?: string | null
          created_at?: string
          currency?: string
          delivery_type?: string
          fulfilment_status?: string
          id?: string
          line_items?: Json
          order_number?: string
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          project_id?: string | null
          share_enabled?: boolean
          share_token?: string | null
          shipping_address?: Json | null
          shipping_cents?: number
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          config_snapshot?: Json
          contact_email?: string | null
          created_at?: string
          currency?: string
          delivery_type?: string
          fulfilment_status?: string
          id?: string
          line_items?: Json
          order_number?: string
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          project_id?: string | null
          share_enabled?: boolean
          share_token?: string | null
          shipping_address?: Json | null
          shipping_cents?: number
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_locale: string
          shipping_address: Json | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          preferred_locale?: string
          shipping_address?: Json | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_locale?: string
          shipping_address?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          approved_at: string | null
          config: Json
          created_at: string
          edit_settings: Json
          generation_engine: string
          generation_error: string | null
          generation_plan: string | null
          generation_progress: number
          generation_seconds: number | null
          generation_stage: string | null
          generation_started_at: string | null
          id: string
          model_provider: string | null
          model_url: string | null
          premium_generations: number
          preview_image_url: string | null
          preview_video_url: string | null
          provider_job_id: string | null
          session_hash: string | null
          source_photos: Json
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          config?: Json
          created_at?: string
          edit_settings?: Json
          generation_engine?: string
          generation_error?: string | null
          generation_plan?: string | null
          generation_progress?: number
          generation_seconds?: number | null
          generation_stage?: string | null
          generation_started_at?: string | null
          id?: string
          model_provider?: string | null
          model_url?: string | null
          premium_generations?: number
          preview_image_url?: string | null
          preview_video_url?: string | null
          provider_job_id?: string | null
          session_hash?: string | null
          source_photos?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          config?: Json
          created_at?: string
          edit_settings?: Json
          generation_engine?: string
          generation_error?: string | null
          generation_plan?: string | null
          generation_progress?: number
          generation_seconds?: number | null
          generation_stage?: string | null
          generation_started_at?: string | null
          id?: string
          model_provider?: string | null
          model_url?: string | null
          premium_generations?: number
          preview_image_url?: string | null
          preview_video_url?: string | null
          provider_job_id?: string | null
          session_hash?: string | null
          source_photos?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trusted_mfa_devices: {
        Row: {
          created_at: string
          device_hash: string
          expires_at: string
          id: string
          label: string | null
          last_used_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          expires_at?: string
          id?: string
          label?: string | null
          last_used_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          expires_at?: string
          id?: string
          label?: string | null
          last_used_at?: string
          user_id?: string
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
      get_shared_preview: {
        Args: { _token: string }
        Returns: {
          config_snapshot: Json
          created_at: string
          delivery_type: string
          model_url: string
          order_number: string
          project_title: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "customer"
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
      app_role: ["admin", "customer"],
    },
  },
} as const

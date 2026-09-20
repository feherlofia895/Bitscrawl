export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
      bug_reports: {
        Row: {
          category: string
          created_at: string
          description: string
          id: number
          reporter_name: string | null
          room_code: string | null
          room_id: number | null
          status: string
          steps: string | null
          technical_context: Json
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          id?: never
          reporter_name?: string | null
          room_code?: string | null
          room_id?: number | null
          status?: string
          steps?: string | null
          technical_context?: Json
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: never
          reporter_name?: string | null
          room_code?: string | null
          room_id?: number | null
          status?: string
          steps?: string | null
          technical_context?: Json
          user_id?: string
        }
        Relationships: []
      }
      game_rounds: {
        Row: {
          created_at: string
          drawer_user_id: string
          drawing_ends_at: string | null
          drawing_started_at: string | null
          finished_at: string | null
          id: number
          room_id: number
          round_number: number
          status: string
        }
        Insert: {
          created_at?: string
          drawer_user_id: string
          drawing_ends_at?: string | null
          drawing_started_at?: string | null
          finished_at?: string | null
          id?: never
          room_id: number
          round_number: number
          status?: string
        }
        Update: {
          created_at?: string
          drawer_user_id?: string
          drawing_ends_at?: string | null
          drawing_started_at?: string | null
          finished_at?: string | null
          id?: never
          room_id?: number
          round_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'game_rounds_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
        ]
      }
      lobby_messages: {
        Row: {
          content: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      room_players: {
        Row: {
          avatar_pixels: Json | null
          display_name: string
          id: number
          joined_at: string
          last_seen_at: string
          room_id: number
          score: number
          user_id: string
        }
        Insert: {
          avatar_pixels?: Json | null
          display_name: string
          id?: never
          joined_at?: string
          last_seen_at?: string
          room_id: number
          score?: number
          user_id: string
        }
        Update: {
          avatar_pixels?: Json | null
          display_name?: string
          id?: never
          joined_at?: string
          last_seen_at?: string
          room_id?: number
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'room_players_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_pixels: Json | null
          created_at: string
          display_name: string
          user_id: string
        }
        Insert: {
          avatar_pixels?: Json | null
          created_at?: string
          display_name: string
          user_id: string
        }
        Update: {
          avatar_pixels?: Json | null
          created_at?: string
          display_name?: string
          user_id?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          round_duration_seconds: number
          code: string
          created_at: string
          finished_at: string | null
          host_user_id: string
          id: number
          max_players: number
          palette_size: number
          started_at: string | null
          status: string
          test_mode: boolean
        }
        Insert: {
          round_duration_seconds?: number
          code: string
          created_at?: string
          finished_at?: string | null
          host_user_id: string
          id?: never
          max_players?: number
          palette_size?: number
          started_at?: string | null
          status?: string
          test_mode?: boolean
        }
        Update: {
          round_duration_seconds?: number
          code?: string
          created_at?: string
          finished_at?: string | null
          host_user_id?: string
          id?: never
          max_players?: number
          palette_size?: number
          started_at?: string | null
          status?: string
          test_mode?: boolean
        }
        Relationships: []
      }
      round_draw_events: {
        Row: {
          changes: Json
          created_at: string
          created_by: string
          id: number
          room_id: number
          round_id: number
        }
        Insert: {
          changes: Json
          created_at?: string
          created_by: string
          id?: never
          room_id: number
          round_id: number
        }
        Update: {
          changes?: Json
          created_at?: string
          created_by?: string
          id?: never
          room_id?: number
          round_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'round_draw_events_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'round_draw_events_round_id_fkey'
            columns: ['round_id']
            isOneToOne: false
            referencedRelation: 'game_rounds'
            referencedColumns: ['id']
          },
        ]
      }
      room_messages: {
        Row: {
          content: string
          created_at: string
          id: number
          room_id: number
          sender_user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          room_id: number
          sender_user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          room_id?: number
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'room_messages_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
        ]
      }
      round_messages: {
        Row: {
          content: string | null
          created_at: string
          id: number
          kind: string
          room_id: number
          round_id: number
          sender_user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: never
          kind: string
          room_id: number
          round_id: number
          sender_user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: never
          kind?: string
          room_id?: number
          round_id?: number
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'round_messages_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'round_messages_round_id_fkey'
            columns: ['round_id']
            isOneToOne: false
            referencedRelation: 'game_rounds'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_game: {
        Args: { target_round_id: number }
        Returns: {
          next_round_id: number
          next_round_number: number
          room_id: number
          room_status: string
        }[]
      }
      choose_round_word: {
        Args: { selected_word: string; target_round_id: number }
        Returns: {
          chosen_word: string
          round_id: number
          round_status: string
        }[]
      }
      create_room: {
        Args: { player_name: string }
        Returns: {
          player_id: number
          room_code: string
          room_id: number
        }[]
      }
      create_room_with_duration: {
        Args: { player_name: string; duration_seconds?: number }
        Returns: {
          player_id: number
          room_code: string
          room_id: number
        }[]
      }
      set_room_round_duration: {
        Args: { target_room_id: number; duration_seconds: number }
        Returns: {
          room_id: number
          round_duration_seconds: number
        }[]
      }
      finish_expired_round: {
        Args: { target_round_id: number }
        Returns: {
          round_id: number
          round_status: string
        }[]
      }
      get_round_view: {
        Args: { target_room_id: number }
        Returns: {
          chosen_word: string
          correct_guess_count: number
          drawer_user_id: string
          drawing_ends_at: string
          finished_at: string
          is_drawer: boolean
          next_round_at: string
          round_id: number
          round_number: number
          round_status: string
          server_now: string
          total_rounds: number
          word_options: string[]
        }[]
      }
      get_weekly_challenges: {
        Args: Record<PropertyKey, never>
        Returns: {
          challenge_id: number
          challenge_status: string
          description: string | null
          ends_at: string
          prompt: string
          server_now: string
          starts_at: string
          week_key: string
        }[]
      }
      get_monthly_challenges: {
        Args: Record<PropertyKey, never>
        Returns: {
          challenge_id: number
          challenge_status: string
          description: string | null
          ends_at: string
          month_key: string
          prompt: string
          server_now: string
          starts_at: string
          voting_starts_at: string
        }[]
      }
      get_global_lobby_messages: {
        Args: Record<PropertyKey, never>
        Returns: {
          author_avatar: Json | null
          author_name: string
          content: string
          created_at: string
          is_own: boolean
          message_id: number
        }[]
      }
      get_gallery_comments: {
        Args: { target_challenge_id: number; target_kind: string }
        Returns: {
          author_avatar: Json | null
          author_name: string
          comment_id: number
          content: string
          created_at: string
          entry_id: number
          is_own: boolean
        }[]
      }
      get_monthly_gallery: {
        Args: { target_challenge_id: number }
        Returns: {
          author_avatar: Json | null
          author_name: string
          entry_id: number
          has_voted: boolean
          is_own: boolean
          is_winner: boolean
          pixels: Json
          updated_at: string
          vote_count: number
        }[]
      }
      get_monthly_account_state: {
        Args: { target_challenge_id: number }
        Returns: {
          entry_id: number | null
          entry_pixels: Json | null
          profile_name: string | null
          submitted_at: string | null
          updated_at: string | null
          votes_used: number
        }[]
      }
      get_online_profiles: {
        Args: { requested_user_ids: string[] }
        Returns: {
          avatar_pixels: Json | null
          display_name: string
          user_id: string
        }[]
      }
      get_weekly_gallery: {
        Args: { target_challenge_id: number }
        Returns: {
          author_avatar: Json | null
          author_name: string
          entry_id: number
          has_voted: boolean
          is_own: boolean
          is_winner: boolean
          pixels: Json
          submitted_at: string
          vote_count: number
        }[]
      }
      get_weekly_account_state: {
        Args: { target_challenge_id: number }
        Returns: {
          draft_pixels: Json | null
          entry_id: number | null
          entry_pixels: Json | null
          profile_name: string | null
          votes_used: number
        }[]
      }
      join_room: {
        Args: { player_name: string; room_code: string }
        Returns: {
          normalized_room_code: string
          player_id: number
          room_id: number
        }[]
      }
      leave_room: {
        Args: { target_room_id: number }
        Returns: {
          host_changed: boolean
          host_user_id: string | null
          room_deleted: boolean
          round_finished: boolean
        }[]
      }
      restart_game: {
        Args: { target_room_id: number }
        Returns: {
          room_id: number
          room_status: string
          started_at: string
        }[]
      }
      send_room_message: {
        Args: { message_content: string; target_room_id: number }
        Returns: number
      }
      send_global_lobby_message: {
        Args: { requested_content: string }
        Returns: number
      }
      save_weekly_draft: {
        Args: { drawing_pixels: Json; target_challenge_id: number }
        Returns: string
      }
      add_gallery_comment: {
        Args: { requested_content: string; target_entry_id: number; target_kind: string }
        Returns: number
      }
      update_gallery_comment: {
        Args: { requested_content: string; target_comment_id: number }
        Returns: string
      }
      save_monthly_entry: {
        Args: { drawing_pixels: Json; target_challenge_id: number }
        Returns: number
      }
      submit_monthly_entry: {
        Args: { target_challenge_id: number }
        Returns: string
      }
      resume_room: {
        Args: { room_code: string }
        Returns: {
          normalized_room_code: string
          player_id: number
          player_name: string
          room_id: number
        }[]
      }
      set_room_test_mode: {
        Args: { target_room_id: number; test_mode_enabled: boolean }
        Returns: {
          room_id: number
          test_mode: boolean
        }[]
      }
      set_weekly_profile: {
        Args: { requested_name: string }
        Returns: string
      }
      set_profile_avatar: {
        Args: { requested_pixels: Json }
        Returns: Json
      }
      set_weekly_vote: {
        Args: { target_entry_id: number; vote_enabled: boolean }
        Returns: { active_vote_count: number; voted: boolean }[]
      }
      set_monthly_vote: {
        Args: { target_entry_id: number; vote_enabled: boolean }
        Returns: { active_vote_count: number; voted: boolean }[]
      }
      set_room_palette_size: {
        Args: { palette_size_value: number; target_room_id: number }
        Returns: {
          palette_size: number
          room_id: number
        }[]
      }
      start_game: {
        Args: { target_room_id: number }
        Returns: {
          room_id: number
          room_status: string
          started_at: string
        }[]
      }
      submit_guess: {
        Args: { submitted_guess: string; target_round_id: number }
        Returns: {
          awarded_points: number
          is_correct: boolean
          message_id: number | null
          round_finished: boolean
        }[]
      }
      submit_pixel_changes: {
        Args: { pixel_changes: Json; target_round_id: number }
        Returns: number
      }
      submit_weekly_entry: {
        Args: { drawing_pixels: Json; target_challenge_id: number }
        Returns: number
      }
      touch_room_presence: {
        Args: { target_room_id: number }
        Returns: {
          host_changed: boolean
          host_user_id: string
          round_finished: boolean
          server_now: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

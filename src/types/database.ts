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
      game_rounds: {
        Row: {
          created_at: string
          drawer_user_id: string
          drawing_started_at: string | null
          id: number
          room_id: number
          round_number: number
          status: string
        }
        Insert: {
          created_at?: string
          drawer_user_id: string
          drawing_started_at?: string | null
          id?: never
          room_id: number
          round_number: number
          status?: string
        }
        Update: {
          created_at?: string
          drawer_user_id?: string
          drawing_started_at?: string | null
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
      room_players: {
        Row: {
          display_name: string
          id: number
          joined_at: string
          room_id: number
          score: number
          user_id: string
        }
        Insert: {
          display_name: string
          id?: never
          joined_at?: string
          room_id: number
          score?: number
          user_id: string
        }
        Update: {
          display_name?: string
          id?: never
          joined_at?: string
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
      rooms: {
        Row: {
          code: string
          created_at: string
          host_user_id: string
          id: number
          max_players: number
          started_at: string | null
          status: string
          test_mode: boolean
        }
        Insert: {
          code: string
          created_at?: string
          host_user_id: string
          id?: never
          max_players?: number
          started_at?: string | null
          status?: string
          test_mode?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          host_user_id?: string
          id?: never
          max_players?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      get_round_view: {
        Args: { target_room_id: number }
        Returns: {
          chosen_word: string
          drawer_user_id: string
          is_drawer: boolean
          round_id: number
          round_number: number
          round_status: string
          word_options: string[]
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
      set_room_test_mode: {
        Args: { target_room_id: number; test_mode_enabled: boolean }
        Returns: {
          room_id: number
          test_mode: boolean
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
      submit_pixel_changes: {
        Args: { pixel_changes: Json; target_round_id: number }
        Returns: number
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

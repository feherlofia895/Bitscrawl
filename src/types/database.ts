export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
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
        }
        Insert: {
          code: string
          created_at?: string
          host_user_id: string
          id?: never
          max_players?: number
          started_at?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          host_user_id?: string
          id?: never
          max_players?: number
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_room: {
        Args: { player_name: string }
        Returns: {
          player_id: number
          room_code: string
          room_id: number
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
      start_game: {
        Args: { target_room_id: number }
        Returns: {
          room_id: number
          room_status: string
          started_at: string
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

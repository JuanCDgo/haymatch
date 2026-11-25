export interface RoomMeta {
  code: string;
  title: string;
  createdAt: string;
  vaquitaEnabled: boolean;
  goalPeople: number;
  depositAmount: number;
  totalAmount: number;
  deadlineText: string;
  aliasMp: string;
}

export type PaymentStatus = 'pendiente' | 'seno' | 'completo';

export interface Participant {
  clientId: string;
  name: string;
  status: PaymentStatus;
  paidAmount: number;
  joinedAt: string;
  isOnline: boolean;
}

export interface RoomOption {
  id: number;
  category: string;
  title: string;
  proposedBy: string;
  yesCount: number;
  noCount: number;
  totalVotes: number;
}

export interface TiebreakResult {
  optionId: number;
  title: string;
  category: string;
  decidedAt: string;
  decidedBy: string;
}

export interface RoomSnapshot {
  room: RoomMeta;
  participants: Participant[];
  onlineCount: number;
  options: RoomOption[];
  myVotes: Record<number, 0 | 1>;
  tiebreak: TiebreakResult | null;
}

export type WsIncoming =
  | { type: 'snapshot'; payload: RoomSnapshot }
  | { type: 'error'; message: string };

export type WsOutgoing =
  | { type: 'join'; clientId: string; name: string }
  | { type: 'vote'; optionId: number; vote: 0 | 1 }
  | { type: 'add_option'; category: string; title: string }
  | { type: 'tiebreak' };

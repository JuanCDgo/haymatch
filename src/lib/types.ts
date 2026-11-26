export type VaquitaMode = 'cuotas' | 'gastos';

export interface RoomMeta {
  code: string;
  title: string;
  createdAt: string;
  vaquitaEnabled: boolean;
  vaquitaMode: VaquitaMode;
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

export interface Expense {
  id: number;
  paidByClientId: string;
  paidByName: string;
  description: string;
  amount: number;
  createdAt: string;
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
  expenses: Expense[];
  myVotes: Record<number, 0 | 1>;
  isOrganizer: boolean;
  tiebreak: TiebreakResult | null;
}

export type WsIncoming =
  | { type: 'snapshot'; payload: RoomSnapshot }
  | { type: 'auth_result'; ok: boolean; message?: string; lockedUntil?: number }
  | { type: 'error'; message: string };

export type WsOutgoing =
  | { type: 'join'; clientId: string; name: string }
  | { type: 'vote'; optionId: number; vote: 0 | 1 }
  | { type: 'add_option'; category: string; title: string }
  | { type: 'tiebreak' }
  | { type: 'auth_organizer'; pin: string }
  | { type: 'logout_organizer' }
  | { type: 'set_payment'; targetClientId: string; status: PaymentStatus }
  | { type: 'add_guest'; name: string; status: PaymentStatus }
  | { type: 'update_alias'; aliasMp: string }
  | { type: 'add_expense'; description: string; amount: number }
  | { type: 'delete_expense'; expenseId: number };

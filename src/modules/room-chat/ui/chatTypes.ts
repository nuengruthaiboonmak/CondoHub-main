'use client';

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  roomId: string;
  senderUserId: string;
  senderName: string;
  senderIsAdmin: boolean;
  clientMessageId: string;
  type: 'TEXT' | 'IMAGE';
  text: string | null;
  imageId: string | null;
  createdAt: string;
}

export type ChatOutgoingStatus = 'sending' | 'failed';

export interface ChatOutgoingEntry {
  clientMessageId: string;
  text: string | null;
  imageId: string | null;
  imageLabel: string | null;
  status: ChatOutgoingStatus;
  createdAt: string;
  error: string | null;
}

export interface ChatListEnvelope {
  data: ChatMessageDto[];
  meta: { nextCursor?: string };
}

export interface ChatSendEnvelope {
  data: ChatMessageDto;
}

export interface ChatErrorEnvelope {
  error: { code: string; message: string };
}

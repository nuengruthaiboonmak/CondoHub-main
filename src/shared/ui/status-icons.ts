import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Tag,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type StatusKind = "success" | "warning" | "danger" | "info" | "neutral" | "pending";

export const STATUS_ICONS: Record<StatusKind, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  neutral: Tag,
  pending: Clock,
};

import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../design/icons";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Accessible name and tooltip text. */
  label: string;
  /** Shortcut shown in the tooltip. */
  kbd?: string;
  size?: number;
  pressed?: boolean;
  variant?: "toolbar" | "button";
}

/** Icon-only button: always has an aria-label and a styled tooltip (TooltipHost). */
export function IconButton({ icon, label, kbd, size = 18, pressed, variant = "toolbar", className, ...rest }: Props) {
  const cls = variant === "toolbar" ? "tb-btn" : "btn btn--icon";
  return (
    <button
      type="button"
      className={className ? `${cls} ${className}` : cls}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={label}
      data-kbd={kbd}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10.8 2.6l2.6 2.6L5.7 12.9 2.5 13.5l.6-3.2z" />
  </Icon>
);
export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3z" />
    <path d="M12.5 10.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
  </Icon>
);
export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12.69 6.57L14.32 7L14.32 9L12.69 9.43L12.33 10.3L13.18 11.76L11.76 13.18L10.3 12.33L9.43 12.69L9 14.32L7 14.32L6.57 12.69L5.7 12.33L4.24 13.18L2.82 11.76L3.67 10.3L3.31 9.43L1.68 9L1.68 7L3.31 6.57L3.67 5.7L2.82 4.24L4.24 2.82L5.7 3.67L6.57 3.31L7 1.68L9 1.68L9.43 3.31L10.3 3.67L11.76 2.82L13.18 4.24L12.33 5.7Z" />
    <circle cx="8" cy="8" r="2.1" />
  </Icon>
);
export const IconSliders = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11M2.5 11.5h11" />
    <circle cx="6" cy="4.5" r="1.6" fill="currentColor" />
    <circle cx="10.5" cy="11.5" r="1.6" fill="currentColor" />
  </Icon>
);
export const IconFocus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
);
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3.5L5.5 8 10 12.5" />
  </Icon>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Icon>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const IconPages = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M2.5 6.5h11M6 6.5v6.5" />
  </Icon>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
  </Icon>
);
export const IconAlignLeft = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7" />
  </Icon>
);
export const IconAlignCenter = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7" />
  </Icon>
);
export const IconAlignRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7" />
  </Icon>
);

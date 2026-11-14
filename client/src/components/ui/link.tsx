import NextLink from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Props = { href: string; external?: boolean; children: ReactNode } & Omit<ComponentProps<"a">, "href" | "children">;

/** Stand-in: sw3 v1 has no text link. Inherits the text colour, with a quiet underline. */
export function TextLink({ href, external, className, children, ...rest }: Props) {
  const cls = `fd-link${className ? ` ${className}` : ""}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" data-fd="link" className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <NextLink href={href} data-fd="link" className={cls} {...rest}>
      {children}
    </NextLink>
  );
}

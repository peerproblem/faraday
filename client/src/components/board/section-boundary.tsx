"use client";

import { Component, type ReactNode } from "react";

type Props = { resetKey: unknown; children: ReactNode };

export class SectionBoundary extends Component<Props, { failed: boolean; key: unknown }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: { failed: boolean; key: unknown }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    return this.state.failed ? <div className="skeleton h-16" /> : this.props.children;
  }
}

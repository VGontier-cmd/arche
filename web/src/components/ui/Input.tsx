/**
 * Input + Textarea primitives — token-driven, replace the dozen-plus
 * `inputClass` strings scattered across the dashboard.
 */

import { forwardRef } from "react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type State = "default" | "error" | "success";

interface SharedFieldProps {
  state?: State;
  label?: string;
  helpText?: string;
  errorText?: string;
  fullWidth?: boolean;
}

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    SharedFieldProps {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    SharedFieldProps {}

const baseFieldStyle = (state: State, hasLeftIcon: boolean): CSSProperties => {
  const borderColor =
    state === "error"
      ? "var(--c-error-fg)"
      : state === "success"
      ? "var(--c-success-fg)"
      : "var(--hairline)";
  return {
    width: "100%",
    background: "var(--surface-0)",
    border: `1px solid ${borderColor}`,
    borderRadius: "var(--radius-sm)",
    color: "var(--c-fog-100)",
    padding: hasLeftIcon ? "6px 10px 6px 30px" : "6px 10px",
    fontSize: "var(--text-body-sm)",
    fontFamily: "inherit",
    lineHeight: 1.4,
    transition:
      "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
    outline: "none",
  };
};

function FieldFrame({
  label,
  helpText,
  errorText,
  state = "default",
  fullWidth = true,
  children,
  htmlFor,
}: {
  label?: string;
  helpText?: string;
  errorText?: string;
  state?: State;
  fullWidth?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div style={{ width: fullWidth ? "100%" : undefined }}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            display: "block",
            fontSize: "var(--text-label-md)",
            fontWeight: 600,
            color: "var(--c-fog-300)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: 6,
          }}
        >
          {label}
        </label>
      )}
      {children}
      {(helpText || errorText) && (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 10,
            color:
              state === "error"
                ? "var(--c-error-fg)"
                : state === "success"
                ? "var(--c-success-fg)"
                : "var(--c-fog-300)",
          }}
          role={errorText ? "alert" : undefined}
        >
          {errorText || helpText}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    state = "default",
    label,
    helpText,
    errorText,
    leftIcon,
    rightIcon,
    fullWidth = true,
    className,
    style,
    id,
    ...rest
  },
  ref,
) {
  const realState: State = errorText ? "error" : state;
  const inputId = id ?? rest.name;
  return (
    <FieldFrame
      label={label}
      helpText={helpText}
      errorText={errorText}
      state={realState}
      fullWidth={fullWidth}
      htmlFor={inputId}
    >
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: fullWidth ? "100%" : undefined,
        }}
      >
        {leftIcon && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--c-fog-300)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          {...rest}
          className={className}
          style={{ ...baseFieldStyle(realState, !!leftIcon), ...style }}
        />
        {rightIcon && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--c-fog-300)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {rightIcon}
          </span>
        )}
      </span>
    </FieldFrame>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      state = "default",
      label,
      helpText,
      errorText,
      fullWidth = true,
      className,
      style,
      id,
      rows = 4,
      ...rest
    },
    ref,
  ) {
    const realState: State = errorText ? "error" : state;
    const inputId = id ?? rest.name;
    return (
      <FieldFrame
        label={label}
        helpText={helpText}
        errorText={errorText}
        state={realState}
        fullWidth={fullWidth}
        htmlFor={inputId}
      >
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          {...rest}
          className={className}
          style={{
            ...baseFieldStyle(realState, false),
            resize: "vertical",
            minHeight: 80,
            lineHeight: 1.5,
            fontFamily: "var(--font-mono)",
            ...style,
          }}
        />
      </FieldFrame>
    );
  },
);

export function Checkbox({
  label,
  description,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        fontSize: "var(--text-body-sm)",
        color: "var(--c-fog-100)",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        {...rest}
        style={{
          accentColor: "var(--c-blue-400)",
          marginTop: 2,
          cursor: rest.disabled ? "not-allowed" : "pointer",
          ...rest.style,
        }}
      />
      <span>
        <span>{label}</span>
        {description && (
          <span
            style={{
              display: "block",
              fontSize: 10,
              color: "var(--c-fog-300)",
              marginTop: 2,
            }}
          >
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

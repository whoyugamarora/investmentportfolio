import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export default function EmptyState({
  title,
  subtitle,
  icon,              // optional: a FontAwesome icon (faPlus, etc.)
  primaryText,
  onPrimary,
  secondaryText,
  onSecondary,
  dark = false,
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center rounded-xl border p-6
        ${dark ? "border-white/10 bg-white/5 text-gray-100" : "border-black/10 bg-gray-50 text-gray-900"}`}
    >
      {icon && (
        <div
          className={`mb-3 h-10 w-10 grid place-items-center rounded-full
            ${dark ? "bg-white/10" : "bg-white"}
          `}
          aria-hidden
        >
          <FontAwesomeIcon icon={icon} />
        </div>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      {subtitle && (
        <p className={`mt-1 text-sm ${dark ? "text-gray-300" : "text-gray-600"}`}>
          {subtitle}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {onPrimary && (
          <button
            onClick={onPrimary}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {primaryText}
          </button>
        )}
        {onSecondary && (
          <button
            onClick={onSecondary}
            className={`px-3 py-2 rounded-lg text-sm font-medium border
              ${dark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50"}`}
          >
            {secondaryText}
          </button>
        )}
      </div>
    </div>
  );
}

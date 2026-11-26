import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Brand name.
    <Svg accessibilityLabel="Sele" height={props.height} width={props.height} viewBox="6 6 52 52">
      <ThemedPath
        d="M28.5 41.2L11.6 24.4A9 9 0 0 1 24.4 11.6L28.5 15.8M35.5 22.8L52.4 39.6A9 9 0 0 1 39.6 52.4L35.5 48.2M22.8 28.5L39.6 11.6A9 9 0 0 1 52.4 24.4L48.2 28.5M41.2 35.5L24.4 52.4A9 9 0 0 1 11.6 39.6L15.8 35.5"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="none"
        stroke="currentColor"
        strokeWidth={5.5}
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

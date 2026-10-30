export interface CurrentConditionsChange {
  baselineReleaseId: string;
}

export type CurrentConditionsConnectionStatus = "connected" | "unavailable";

export interface CurrentConditionsChangeFeed {
  subscribe(
    baselineReleaseId: string,
    onChange: () => void,
    onStatus: (status: CurrentConditionsConnectionStatus) => void,
  ): () => void;
}

export interface CurrentConditionsChangePublisher {
  publish(change: CurrentConditionsChange): Promise<void>;
}

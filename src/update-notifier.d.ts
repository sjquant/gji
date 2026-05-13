declare module "update-notifier" {
	interface PackageMetadata {
		name: string;
		version: string;
	}

	interface Notifier {
		notify(): void;
	}

	interface UpdateNotifierOptions {
		pkg: PackageMetadata;
	}

	export default function updateNotifier(
		options: UpdateNotifierOptions,
	): Notifier;
}

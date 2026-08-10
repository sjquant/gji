export interface NavigationRepository {
	name: string;
	root: string;
}

export interface NavigationTarget {
	branch: string | null;
	path: string;
	repository: NavigationRepository;
}

export function createNavigationTarget(
	repository: NavigationRepository,
	path: string,
	branch: string | null,
): NavigationTarget {
	return { branch, path, repository };
}

export function createNavigationRepository(
	name: string,
	root: string,
): NavigationRepository {
	return { name, root };
}

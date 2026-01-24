.PHONY: build
build:
	npm run build

.PHONY: test
test:
	npm run lint
	npm test

.PHONY: format
format:
	npm run format

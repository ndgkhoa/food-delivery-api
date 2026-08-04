# Changelog

## [1.2.2](https://github.com/ndgkhoa/food-delivery-api/compare/v1.2.1...v1.2.2) (2026-08-04)


### Bug Fixes

* **ci:** align commitlint scope-enum with the actual shared libs ([056ebca](https://github.com/ndgkhoa/food-delivery-api/commit/056ebcaffa5989a53ecd2005664d8443b78d2428))
* **infra:** stop pinning the prod overlay image to latest ([45e7a60](https://github.com/ndgkhoa/food-delivery-api/commit/45e7a60aa4949d062ac105595c49186268963acf))

## [1.2.1](https://github.com/ndgkhoa/food-delivery-api/compare/v1.2.0...v1.2.1) (2026-08-03)


### Bug Fixes

* **infra:** remediate uuid CVE-2026-41907 and harden CI/CD image pipeline ([#60](https://github.com/ndgkhoa/food-delivery-api/issues/60)) ([6c1474e](https://github.com/ndgkhoa/food-delivery-api/commit/6c1474e5b1500489eb4143706551373124b4b3c4))

## [1.2.0](https://github.com/ndgkhoa/food-delivery-api/compare/v1.1.0...v1.2.0) (2026-08-03)


### Features

* **order:** admin DLQ-replay endpoint for escalated sagas ([#57](https://github.com/ndgkhoa/food-delivery-api/issues/57)) ([5873141](https://github.com/ndgkhoa/food-delivery-api/commit/587314165c05e5ec651677322658a8903dc9eeb8))

## [1.1.0](https://github.com/ndgkhoa/food-delivery-api/compare/v1.0.1...v1.1.0) (2026-08-03)


### Features

* **infra:** consolidate the 13 service images into one food-delivery-api image ([#52](https://github.com/ndgkhoa/food-delivery-api/issues/52)) ([b872133](https://github.com/ndgkhoa/food-delivery-api/commit/b87213353742780c56d481e5efc49d84bc76b1c4))
* **shared-tenancy:** sign and verify the east-west grpc tenant identity ([#54](https://github.com/ndgkhoa/food-delivery-api/issues/54)) ([835de98](https://github.com/ndgkhoa/food-delivery-api/commit/835de98186adc4b008b133c7f7cc74aaa457c88d))


### Bug Fixes

* **infra:** point the base otel endpoint at the observability namespace ([#53](https://github.com/ndgkhoa/food-delivery-api/issues/53)) ([bd5f901](https://github.com/ndgkhoa/food-delivery-api/commit/bd5f901e08ea2bb21e31098e0642eba713894f65))

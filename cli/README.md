# CADHub CLI

Use this to push code-CAD projects to CADHub! 

Original design at https://docs.google.com/document/d/1ZVFHD3BNcS2dRsf56PRBp2zTlAgVJ9VeDDxuW8IXBPY/ (TODO: convert to markdown and check in)

## Usage

```shell
yarn start push "**/*.cadhub.yml" -vvvvvv

# Allow deleting projects:
yarn start push "**/*.cadhub.yml" -vvvvvv --delete-missing-projects

```


FROM golang:1.25
# ERROR: image and tag are separated by a COLON, not a space -> FROM golang:1.25
# As written this is invalid ("golang" is treated as the image and "1.25" as a stage name), so the build fails.

WorkDIR /app

copy go.mod go.sum ./
# ERROR 1: this project has no go.mod / go.sum yet, so the build fails with "file not found".
#          Create them first (go mod init gin-demo && go mod tidy) or let the Dockerfile create them.
# ERROR 2: COPY with 2 source files needs a destination directory -> COPY go.mod go.sum ./

RUN go mod download 

COPY . .
# ERROR: ".." points outside the build context, Docker forbids that -> COPY . .   (first . = your folder, second . = /app)

RUN go build -o server .
# ERROR: the flag must be written as one token, and you must tell Go which package to build -> RUN go build -o server .
#         -o server = name of the output binary, "." = current directory (your main package)
EXPOSE 8000

CMD ["./server"]
# ERROR: "and" is not a Docker instruction -> ENTRYPOINT ["./server"]   (or CMD ["./server"])
# Note: the ENTRYPOINT/CMD line must be LAST (there must be no instruction after it).